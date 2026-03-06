import { connect, NodeWebSocketFactory, type PlatformClient } from '@hcengineering/api-client'

import { getConfig } from '../config.js'
import { logger } from '../logger.js'

const log = logger.child({ scope: 'huly-client' })

export async function getHulyClient(userId: number): Promise<PlatformClient> {
  log.debug({ userId }, 'getHulyClient called')

  const url = process.env['HULY_URL']
  if (url === undefined || url === '') {
    log.error({}, 'HULY_URL environment variable not set')
    throw new Error('HULY_URL environment variable is required')
  }

  const workspace = process.env['HULY_WORKSPACE']
  if (workspace === undefined || workspace === '') {
    log.error({}, 'HULY_WORKSPACE environment variable not set')
    throw new Error('HULY_WORKSPACE environment variable is required')
  }

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

  log.info({ userId, workspace }, 'Connecting to Huly')

  const client = await connect(url, {
    email,
    password,
    workspace,
    socketFactory: NodeWebSocketFactory,
    connectionTimeout: 30000,
  })

  return client
}
