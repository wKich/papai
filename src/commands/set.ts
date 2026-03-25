import type { ChatProvider, CommandHandler } from '../chat/types.js'
import { isConfigKey, setConfig } from '../config.js'
import { logger } from '../logger.js'
import { CONFIG_KEYS, type ConfigKey } from '../types/config.js'
import { normalizeTimezone } from '../utils/timezone.js'

const log = logger.child({ scope: 'commands:set' })

// Config keys that contain sensitive information and should be redacted
const SENSITIVE_KEYS: readonly ConfigKey[] = ['llm_apikey', 'kaneo_apikey', 'youtrack_token']

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
    let normalizedValue = value
    if (key === 'timezone') {
      const resolved = normalizeTimezone(value)
      if (resolved === null) {
        await reply.text(
          `Invalid timezone: "${value}"\nUse an IANA timezone name (e.g. Asia/Karachi) or UTC offset (e.g. UTC+5).`,
        )
        return
      }
      normalizedValue = resolved
    }
    setConfig(auth.storageContextId, key, normalizedValue)
    log.info({ userId: msg.user.id, storageContextId: auth.storageContextId, key }, '/set command executed')

    // Redact message if it contains sensitive information
    if (SENSITIVE_KEYS.includes(key)) {
      const redactedText = `/set ${key} [REDACTED]`
      await reply.redactMessage?.(redactedText).catch(() => undefined)
    }

    await reply.text(`Set ${key} successfully.`)
  }

  chat.registerCommand('set', handler)
}
