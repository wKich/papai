import type { ChatProvider, CommandHandler, ReplyFn } from '../chat/types.js'
import { isConfigKey, setConfig } from '../config.js'
import { logger } from '../logger.js'
import { CONFIG_KEYS, type ConfigKey } from '../types/config.js'
import { normalizeTimezone } from '../utils/timezone.js'

const log = logger.child({ scope: 'commands:set' })

// Config keys that contain sensitive information and should be redacted
const SENSITIVE_KEYS: readonly ConfigKey[] = ['llm_apikey', 'kaneo_apikey', 'youtrack_token']

function parseKeyValue(input: string): { key: string; value: string } | null {
  const spaceIndex = input.indexOf(' ')
  if (spaceIndex === -1) return null
  return {
    key: input.slice(0, spaceIndex).trim(),
    value: input.slice(spaceIndex + 1).trim(),
  }
}

function normalizeValue(key: ConfigKey, value: string): string | null {
  if (key === 'timezone') {
    const resolved = normalizeTimezone(value)
    if (resolved === null) return null
    return resolved
  }
  return value
}

async function handleConfigUpdate(
  key: ConfigKey,
  value: string,
  storageContextId: string,
  userId: string,
  reply: ReplyFn,
): Promise<void> {
  const normalizedValue = normalizeValue(key, value)
  if (normalizedValue === null) {
    await reply.text(
      `Invalid timezone: "${value}"\nUse an IANA timezone name (e.g. Asia/Karachi) or UTC offset (e.g. UTC+5).`,
    )
    return
  }

  setConfig(storageContextId, key, normalizedValue)
  log.info({ userId, storageContextId, key }, '/set command executed')

  // Redact message if it contains sensitive information
  if (SENSITIVE_KEYS.includes(key)) {
    const redactedText = `/set ${key} [REDACTED]`
    await reply.redactMessage?.(redactedText).catch(() => undefined)
  }

  await reply.text(`Set ${key} successfully.`)
}

async function showHelp(reply: ReplyFn): Promise<void> {
  await reply.text(
    '💡 **Configuration Help**\n\n' +
      'Use `/setup` for an interactive wizard (recommended)\n' +
      'Or use `/set <key> <value>` for manual configuration\n\n' +
      'Example: `/set llm_apikey sk-...`',
  )
}

async function handleSetCommand(
  commandMatch: string | undefined,
  storageContextId: string,
  userId: string,
  reply: ReplyFn,
): Promise<void> {
  const match = (commandMatch ?? '').trim()
  if (match === '') {
    await showHelp(reply)
    return
  }

  const parsed = parseKeyValue(match)
  if (parsed === null) {
    await reply.text(`Usage: /set <key> <value>\nValid keys: ${CONFIG_KEYS.join(', ')}`)
    return
  }

  if (!isConfigKey(parsed.key)) {
    await reply.text(`Unknown key: ${parsed.key}\nValid keys: ${CONFIG_KEYS.join(', ')}`)
    return
  }

  await handleConfigUpdate(parsed.key, parsed.value, storageContextId, userId, reply)
}

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

    await handleSetCommand(msg.commandMatch, auth.storageContextId, msg.user.id, reply)
  }

  chat.registerCommand('set', handler)
}
