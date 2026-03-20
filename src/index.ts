import { announceNewVersion } from './announcements.js'
import { setupBot } from './bot.js'
import { createChatProvider } from './chat/registry.js'
import { closeDrizzleDb } from './db/drizzle.js'
import { closeMigrationDbInstance, initDb } from './db/index.js'
import { logger } from './logger.js'
import { addUser } from './users.js'

const hasSetCommands = (chat: unknown): chat is { setCommands: (adminUserId: string) => Promise<void> } =>
  typeof chat === 'object' && chat !== null && 'setCommands' in chat

const log = logger.child({ scope: 'main' })

const REQUIRED_ENV_VARS = ['CHAT_PROVIDER', 'ADMIN_USER_ID']

const missing = REQUIRED_ENV_VARS.filter((v) => (process.env[v]?.trim() ?? '') === '')
if (missing.length > 0) {
  log.error({ variables: missing }, 'Missing required environment variables')
  process.exit(1)
}

log.info('Starting papai...')

try {
  initDb()
} catch (error) {
  log.error({ error: error instanceof Error ? error.message : String(error) }, 'Database migration failed')
  process.exit(1)
}

const adminUserId = process.env['ADMIN_USER_ID']!
addUser(adminUserId, adminUserId)

const chatProvider = createChatProvider(process.env['CHAT_PROVIDER']!)

log.info({ adminUserId, chatProvider: process.env['CHAT_PROVIDER'] }, 'Starting papai...')

setupBot(chatProvider, adminUserId)

await chatProvider.start()

if (hasSetCommands(chatProvider)) {
  void chatProvider.setCommands(adminUserId)
}

void announceNewVersion(chatProvider)

process.on('SIGINT', () => {
  log.info('SIGINT received, shutting down gracefully')
  void chatProvider.stop()
  closeDrizzleDb()
  closeMigrationDbInstance()
  process.exit(0)
})

process.on('SIGTERM', () => {
  log.info('SIGTERM received, shutting down gracefully')
  void chatProvider.stop()
  closeDrizzleDb()
  closeMigrationDbInstance()
  process.exit(0)
})
