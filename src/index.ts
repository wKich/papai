import { bot } from './bot.js'
import { logger } from './logger.js'

const REQUIRED_ENV_VARS = [
  'TELEGRAM_BOT_TOKEN',
  'TELEGRAM_USER_ID',
  'LINEAR_API_KEY',
  'LINEAR_TEAM_ID',
  'OPENAI_API_KEY',
]

const missing = REQUIRED_ENV_VARS.filter((v) => (process.env[v]?.trim() ?? '') === '')
if (missing.length > 0) {
  logger.error({ variables: missing }, 'Missing required environment variables')
  process.exit(1)
}

logger.info('Starting papai...')

void bot.start({
  onStart: () => {
    logger.info('papai is running and listening for messages.')
  },
})
