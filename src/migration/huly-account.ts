import { randomUUID } from 'node:crypto'

import { getClient as getAccountClient } from '@hcengineering/account-client'
import { loadServerConfig } from '@hcengineering/api-client'
import { AccountRole } from '@hcengineering/core'

import { getConfig, setConfig } from '../config.js'
import { getDb } from '../db/index.js'
import { hulyUrl, hulyWorkspace } from '../huly/env.js'
import { logger } from '../logger.js'

const log = logger.child({ scope: 'migration:account' })

export interface HulyCredentials {
  email: string
  password: string
}

export function getExistingCredentials(userId: number): HulyCredentials | null {
  const email = getConfig(userId, 'huly_email')
  const password = getConfig(userId, 'huly_password')
  if (email !== null && password !== null) return { email, password }
  return null
}

function findAdminCredentials(): HulyCredentials | null {
  const row = getDb()
    .query<{ email: string; password: string }, []>(
      `SELECT a.value AS email, b.value AS password
       FROM user_config a
       JOIN user_config b ON a.user_id = b.user_id
       WHERE a.key = 'huly_email' AND b.key = 'huly_password'
       LIMIT 1`,
    )
    .get()
  return row ?? null
}

export function ensureHulyCredentials(userId: number): Promise<HulyCredentials> {
  const existing = getExistingCredentials(userId)
  if (existing !== null) {
    log.debug({ userId }, 'Using existing Huly credentials')
    return Promise.resolve(existing)
  }

  return provisionHulyAccount(userId)
}

async function provisionHulyAccount(userId: number): Promise<HulyCredentials> {
  const admin = findAdminCredentials()
  if (admin === null) {
    throw new Error('No Huly admin credentials found — set huly_email and huly_password for at least one user')
  }

  const email = `user-${userId}-${randomUUID().slice(0, 8)}@migration.local`
  const password = randomUUID()

  log.info({ userId, email }, 'Provisioning new Huly account')

  const config = await loadServerConfig(hulyUrl)
  const accountsUrl = config.ACCOUNTS_URL

  // Admin authenticates, selects workspace (gets workspace-scoped token), creates invite
  const anonClient = getAccountClient(accountsUrl)
  const loginInfo = await anonClient.login(admin.email, admin.password)
  const loginClient = getAccountClient(accountsUrl, loginInfo.token)
  const wsInfo = await loginClient.selectWorkspace(hulyWorkspace)
  const adminClient = getAccountClient(accountsUrl, wsInfo.token)
  // 1-hour expiry, single-use
  const expiresAt = Date.now() + 60 * 60 * 1000
  const inviteId = await adminClient.createInvite(expiresAt, email, 1, AccountRole.User)

  // New user signs up and joins the workspace in one step
  const newUserClient = getAccountClient(accountsUrl)
  await newUserClient.signUpJoin(email, password, 'User', String(userId), inviteId, hulyWorkspace)

  setConfig(userId, 'huly_email', email)
  setConfig(userId, 'huly_password', password)

  log.info({ userId, email }, 'Huly account provisioned and joined workspace')
  return { email, password }
}
