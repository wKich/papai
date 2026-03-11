import type { Bot } from 'grammy'

import { clearHistory } from '../history.js'
import { logger } from '../logger.js'
import { clearFacts, clearSummary } from '../memory.js'
import { listUsers } from '../users.js'

const log = logger.child({ scope: 'commands:clear' })

export function registerClearCommand(
  bot: Bot,
  checkAuthorization: (userId: number | undefined, username?: string) => userId is number,
  adminUserId: number,
): void {
  bot.command('clear', async (ctx) => {
    const userId = ctx.from?.id
    if (!checkAuthorization(userId, ctx.from?.username)) return
    log.debug({ userId }, '/clear command called')
    const arg = ctx.match.trim()
    if (arg === '') {
      clearHistory(userId)
      clearSummary(userId)
      clearFacts(userId)
      log.info({ userId }, '/clear command executed — all memory tiers cleared')
      await ctx.reply('Conversation history and memory cleared.')
      return
    }
    if (userId !== adminUserId) {
      await ctx.reply("Only the admin can clear other users' history.")
      return
    }
    if (arg === 'all') {
      const users = listUsers()
      for (const user of users) {
        clearHistory(user.telegram_id)
        clearSummary(user.telegram_id)
        clearFacts(user.telegram_id)
      }
      log.info({ userId, clearedCount: users.length }, '/clear all executed')
      await ctx.reply(`Cleared history and memory for all ${users.length} users.`)
      return
    }
    const targetId = parseInt(arg, 10)
    if (Number.isNaN(targetId)) {
      await ctx.reply('Usage: /clear [all | <user_id>]')
      return
    }
    clearHistory(targetId)
    clearSummary(targetId)
    clearFacts(targetId)
    log.info({ userId, targetId }, '/clear <user_id> executed')
    await ctx.reply(`Cleared history and memory for user ${targetId}.`)
  })
}
