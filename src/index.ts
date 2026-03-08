import { bot } from './bot.js'
import { closeDb, initDb } from './db/index.js'
import { isMigrationComplete } from './db/migration-status.js'
import { logger } from './logger.js'
import { migrateToMultiUser } from './migrate.js'
import { runLinearToHulyMigration } from './migration/migrate.js'

const log = logger.child({ scope: 'main' })

const REQUIRED_ENV_VARS = ['TELEGRAM_BOT_TOKEN', 'TELEGRAM_USER_ID', 'HULY_URL', 'HULY_WORKSPACE']

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
try {
  migrateToMultiUser(adminId)
  log.info({ adminId }, 'Multi-user migration complete')
} catch (error) {
  log.error({ error: error instanceof Error ? error.message : String(error) }, 'Multi-user migration failed')
  process.exit(1)
}

// Run Linear to Huly migration if needed
if (!isMigrationComplete('linear_to_huly')) {
  log.info('Linear to Huly migration not complete, running migration...')
  const result = await runLinearToHulyMigration()
  if (!result.success) {
    log.error({ errors: result.errors }, 'Migration failed but continuing startup')
    // Don't fail startup on migration error - allow manual retry
  }
}

void bot.start({
  onStart: () => {
    log.info('papai is running and listening for messages.')
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
