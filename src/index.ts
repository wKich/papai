import { bot } from './bot.js'
import { logger } from './logger.js'

const log = logger.child({ scope: 'main' })

const REQUIRED_ENV_VARS = ['TELEGRAM_BOT_TOKEN', 'TELEGRAM_USER_ID']

const missing = REQUIRED_ENV_VARS.filter((v) => (process.env[v]?.trim() ?? '') === '')
if (missing.length > 0) {
  log.error({ variables: missing }, 'Missing required environment variables')
  process.exit(1)
}

log.info('Starting papai...')

void bot.start({
  onStart: () => {
    log.info('papai is running and listening for messages.')
  },
})
