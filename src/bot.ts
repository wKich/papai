import { Bot } from 'grammy'

import {
  registerAdminCommands,
  registerClearCommand,
  registerConfigCommand,
  registerContextCommand,
  registerHelpCommand,
  registerSetCommand,
} from './commands/index.js'
import { processMessage } from './llm-orchestrator.js'
import { logger } from './logger.js'
import { isAuthorized, resolveUserByUsername } from './users.js'

const log = logger.child({ scope: 'bot' })

const bot = new Bot(process.env['TELEGRAM_BOT_TOKEN']!)
const adminUserId = parseInt(process.env['TELEGRAM_USER_ID']!, 10)

const checkAuthorization = (userId: number | undefined, username?: string): userId is number => {
  log.debug({ userId }, 'Checking authorization')
  if (userId === undefined) return false
  if (isAuthorized(userId)) return true
  if (username !== undefined && resolveUserByUsername(userId, username)) return true
  log.warn({ attemptedUserId: userId }, 'Unauthorized access attempt')
  return false
}

registerHelpCommand(bot, checkAuthorization, adminUserId)
registerSetCommand(bot, checkAuthorization)
registerConfigCommand(bot, checkAuthorization)
registerContextCommand(bot, adminUserId)
registerClearCommand(bot, checkAuthorization, adminUserId)
registerAdminCommands(bot, adminUserId)

bot.on('message:text', async (ctx) => {
  const userId = ctx.from?.id
  if (!checkAuthorization(userId, ctx.from?.username)) {
    return
  }
  const userText = ctx.message.text
  await processMessage(ctx, userId, userText)
})

export { bot }
