import type { Bot } from 'grammy'

import { CONFIG_KEYS, isConfigKey, setConfig } from '../config.js'
import { logger } from '../logger.js'

const log = logger.child({ scope: 'commands:set' })

export function registerSetCommand(
  bot: Bot,
  checkAuthorization: (userId: number | undefined, username?: string) => userId is number,
): void {
  bot.command('set', async (ctx) => {
    const userId = ctx.from?.id
    if (!checkAuthorization(userId, ctx.from?.username)) {
      return
    }
    const match = ctx.match.trim()
    const spaceIndex = match.indexOf(' ')
    if (spaceIndex === -1) {
      await ctx.reply(`Usage: /set <key> <value>\nValid keys: ${CONFIG_KEYS.join(', ')}`)
      return
    }
    const key = match.slice(0, spaceIndex).trim()
    const value = match.slice(spaceIndex + 1).trim()
    if (!isConfigKey(key)) {
      await ctx.reply(`Unknown key: ${key}\nValid keys: ${CONFIG_KEYS.join(', ')}`)
      return
    }
    setConfig(userId, key, value)
    log.info({ userId, key }, '/set command executed')
    await ctx.reply(`Set ${key} successfully.`)
  })
}
