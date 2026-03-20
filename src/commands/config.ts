import type { ChatProvider, CommandHandler } from '../chat/types.js'
import { getAllConfig, maskValue } from '../config.js'
import { logger } from '../logger.js'
import { CONFIG_KEYS } from '../types/config.js'

const log = logger.child({ scope: 'commands:config' })

export function registerConfigCommand(
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

    log.debug({ userId: msg.user.id, storageContextId: auth.storageContextId }, '/config command called')
    const config = getAllConfig(auth.storageContextId)
    const lines = CONFIG_KEYS.map((key) => {
      const value = config[key]
      if (value === undefined) {
        return `${key}: (not set)`
      }
      return `${key}: ${maskValue(key, value)}`
    })
    log.info({ userId: msg.user.id, storageContextId: auth.storageContextId }, '/config command executed')
    await reply.text(lines.join('\n'))
  }

  chat.registerCommand('config', handler)
}
