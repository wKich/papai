import type { ChatCapability, ChatProviderConfigRequirement, ChatProviderTraits } from '../types.js'

export const telegramCapabilities: ReadonlySet<ChatCapability> = new Set<ChatCapability>([
  'commands.menu',
  'interactions.callbacks',
  'messages.buttons',
  'messages.files',
  'messages.redact',
  'messages.reply-context',
  'files.receive',
])

export const telegramTraits: ChatProviderTraits = {
  observedGroupMessages: 'all',
  maxMessageLength: 4096,
  callbackDataMaxLength: 64,
}

export const telegramConfigRequirements: ChatProviderConfigRequirement[] = [
  { key: 'TELEGRAM_BOT_TOKEN', label: 'Telegram Bot Token', required: true },
]
