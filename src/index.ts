import { announceNewVersion } from './announcements.js'
import { bot } from './bot.js'
import { setCommands } from './commands/index.js'
import { closeDb, initDb } from './db/index.js'
import { logger } from './logger.js'

const log = logger.child({ scope: 'main' })

const REQUIRED_ENV_VARS = ['TELEGRAM_BOT_TOKEN', 'TELEGRAM_USER_ID', 'KANEO_CLIENT_URL']

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

const adminId = parseInt(process.env['TELEGRAM_USER_ID']!, 10)
log.info({ adminId }, 'Starting papai...')

void bot.start({
  onStart: () => {
    log.info('papai is running and listening for messages.')
    void setCommands(bot, adminId)
    void announceNewVersion(bot)
  },
})

// Graceful shutdown handlers to ensure database connection is closed
process.on('SIGINT', () => {
  log.info('SIGINT received, shutting down gracefully')
  closeDb()
  process.exit(0)
})

process.on('SIGTERM', () => {
  log.info('SIGTERM received, shutting down gracefully')
  closeDb()
  process.exit(0)
})
