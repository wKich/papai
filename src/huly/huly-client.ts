import { connect, NodeWebSocketFactory, type PlatformClient } from '@hcengineering/api-client'

import { getConfig } from '../config.js'
import { logger } from '../logger.js'
import { hulyUrl, hulyWorkspace } from './env.js'

const log = logger.child({ scope: 'huly-client' })

export async function getHulyClient(userId: number): Promise<PlatformClient> {
  log.debug({ userId }, 'getHulyClient called')

  const email = getConfig(userId, 'huly_email')
  if (email === null || email === '') {
    log.error({ userId }, 'huly_email not configured for user')
    throw new Error('huly_email not configured. Use /set huly_email <email>')
  }

  const password = getConfig(userId, 'huly_password')
  if (password === null || password === '') {
    log.error({ userId }, 'huly_password not configured for user')
    throw new Error('huly_password not configured. Use /set huly_password <password>')
  }

  log.info({ userId, workspace: hulyWorkspace }, 'Connecting to Huly')

  const client = await connect(hulyUrl, {
    email,
    password,
    workspace: hulyWorkspace,
    socketFactory: NodeWebSocketFactory,
    connectionTimeout: 30000,
  })

  return client
}
