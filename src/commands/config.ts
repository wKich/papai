import { supportsInteractiveButtons } from '../chat/capabilities.js'
import type { ChatButton, ChatProvider, CommandHandler } from '../chat/types.js'
import { serializeCallbackData } from '../config-editor/index.js'
import { getAllConfig, maskValue } from '../config.js'
import { logger } from '../logger.js'
import { CONFIG_KEYS, type ConfigKey } from '../types/config.js'

const log = logger.child({ scope: 'commands:config' })

const FIELD_DISPLAY_NAMES: Record<ConfigKey, string> = {
  llm_apikey: 'LLM API Key',
  llm_baseurl: 'Base URL',
  main_model: 'Main Model',
  small_model: 'Small Model',
  embedding_model: 'Embedding Model',
  kaneo_apikey: 'Kaneo API Key',
  youtrack_token: 'YouTrack Token',
  timezone: 'Timezone',
}

function getFieldEmoji(key: ConfigKey): string {
  const emojiMap: Record<ConfigKey, string> = {
    llm_apikey: '🔑',
    llm_baseurl: '🌐',
    main_model: '🤖',
    small_model: '⚡',
    embedding_model: '📊',
    kaneo_apikey: '🔐',
    youtrack_token: '🔐',
    timezone: '🌍',
  }
  return emojiMap[key] ?? '⚙️'
}

function formatConfigLine(key: ConfigKey, value: string | undefined): string {
  const displayName = FIELD_DISPLAY_NAMES[key]
  const emoji = getFieldEmoji(key)
  if (value === undefined) {
    return `${emoji} ${displayName}: *(not set)*`
  }
  return `${emoji} ${displayName}: ${maskValue(key, value)}`
}

function buildConfigButtons(config: Partial<Record<ConfigKey, string>>): ChatButton[] {
  const buttons: ChatButton[] = CONFIG_KEYS.map((key) => ({
    text: `${getFieldEmoji(key)} ${FIELD_DISPLAY_NAMES[key]}`,
    callbackData: serializeCallbackData({ action: 'edit', key }),
    style: config[key] === undefined ? 'secondary' : 'primary',
  }))
  buttons.push({
    text: '🔄 Full Setup',
    callbackData: serializeCallbackData({ action: 'setup' }),
    style: 'primary',
  })
  return buttons
}

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

    const lines = ['⚙️ **Current Configuration**\n']

    for (const key of CONFIG_KEYS) {
      const value = config[key]
      lines.push(formatConfigLine(key, value))
    }

    log.info({ userId: msg.user.id, storageContextId: auth.storageContextId }, '/config command executed')

    if (!supportsInteractiveButtons(chat)) {
      lines.push('\n⚠️ Interactive editing is not available in this chat. Use `/set <key> <value>` to update settings.')
      await reply.text(lines.join('\n'))
      return
    }

    lines.push('\n💡 Click a field below to edit it, or use `/setup` to configure everything.')
    await reply.buttons(lines.join('\n'), { buttons: buildConfigButtons(config) })
  }

  chat.registerCommand('config', handler)
}
