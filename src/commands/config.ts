import type { ChatProvider } from '../chat/types.js'
import { getAllConfig, maskValue } from '../config.js'
import { logger } from '../logger.js'
import { CONFIG_KEYS } from '../types/config.js'

const log = logger.child({ scope: 'commands:config' })

export function registerConfigCommand(
  chat: ChatProvider,
  checkAuthorization: (userId: string, username?: string | null) => boolean,
): void {
  chat.registerCommand('config', async (msg, reply) => {
    if (!checkAuthorization(msg.user.id, msg.user.username)) return
    log.debug({ userId: msg.user.id }, '/config command called')
    const config = getAllConfig(msg.user.id)
    const lines = CONFIG_KEYS.map((key) => {
      const value = config[key]
      if (value === undefined) {
        return `${key}: (not set)`
      }
      return `${key}: ${maskValue(key, value)}`
    })
    log.info({ userId: msg.user.id }, '/config command executed')
    await reply.text(lines.join('\n'))
  })
}
