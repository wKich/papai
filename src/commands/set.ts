import type { ChatProvider, CommandHandler } from '../chat/types.js'
import { isConfigKey, setConfig } from '../config.js'
import { logger } from '../logger.js'
import { CONFIG_KEYS } from '../types/config.js'

const log = logger.child({ scope: 'commands:set' })

export function registerSetCommand(
  chat: ChatProvider,
  _checkAuthorization: (userId: string, username?: string | null) => boolean,
): void {
  const handler: CommandHandler = async (msg, reply, auth) => {
    if (!auth.allowed) return

    // In groups, only bot admins and group admins can run this command
    if (msg.contextType === 'group' && !auth.isBotAdmin && !auth.isGroupAdmin) {
      await reply.text('Only group admins can run this command.')
      return
    }

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
    setConfig(auth.storageContextId, key, value)
    log.info({ userId: msg.user.id, storageContextId: auth.storageContextId, key }, '/set command executed')
    await reply.text(`Set ${key} successfully.`)
  }

  chat.registerCommand('set', handler)
}
