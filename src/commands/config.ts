import type { Bot } from 'grammy'

import { getAllConfig, maskValue } from '../config.js'
import { logger } from '../logger.js'
import { CONFIG_KEYS } from '../types/config.js'

const log = logger.child({ scope: 'commands:config' })

export function registerConfigCommand(
  bot: Bot,
  checkAuthorization: (userId: number | undefined, username?: string) => userId is number,
): void {
  bot.command('config', async (ctx) => {
    const userId = ctx.from?.id
    if (!checkAuthorization(userId, ctx.from?.username)) {
      return
    }
    log.debug({ userId }, '/config command called')
    const config = getAllConfig(userId)
    const lines = CONFIG_KEYS.map((key) => {
      const value = config[key]
      if (value === undefined) {
        return `${key}: (not set)`
      }
      return `${key}: ${maskValue(key, value)}`
    })
    log.info({ userId }, '/config command executed')
    await ctx.reply(lines.join('\n'))
  })
}
