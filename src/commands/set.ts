import type { ChatProvider } from '../chat/types.js'
import { isConfigKey, setConfig } from '../config.js'
import { logger } from '../logger.js'
import { CONFIG_KEYS } from '../types/config.js'

const log = logger.child({ scope: 'commands:set' })

export function registerSetCommand(
  chat: ChatProvider,
  checkAuthorization: (userId: string, username?: string | null) => boolean,
): void {
  chat.registerCommand('set', async (msg, reply) => {
    if (!checkAuthorization(msg.user.id, msg.user.username)) return
    const match = (msg.commandMatch ?? '').trim()
    const spaceIndex = match.indexOf(' ')
    if (spaceIndex === -1) {
      await reply.text(`Usage: /set <key> <value>\nValid keys: ${CONFIG_KEYS.join(', ')}`)
      return
    }
    const key = match.slice(0, spaceIndex).trim()
    const value = match.slice(spaceIndex + 1).trim()
    if (!isConfigKey(key)) {
      await reply.text(`Unknown key: ${key}\nValid keys: ${CONFIG_KEYS.join(', ')}`)
      return
    }
    setConfig(msg.user.id, key, value)
    log.info({ userId: msg.user.id, key }, '/set command executed')
    await reply.text(`Set ${key} successfully.`)
  })
}
