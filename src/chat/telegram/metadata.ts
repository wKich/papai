import type { ChatCapability, ChatProviderConfigRequirement, ChatProviderTraits } from '../types.js'

export const telegramCapabilities = new Set<ChatCapability>([
  'commands.menu',
  'interactions.callbacks',
  'messages.buttons',
  'messages.files',
  'messages.redact',
  'messages.reply-context',
  'files.receive',
  'users.resolve',
])

export const telegramTraits: ChatProviderTraits = {
  observedGroupMessages: 'mentions_only',
  maxMessageLength: 4096,
  callbackDataMaxLength: 64,
}

export const telegramConfigRequirements: ChatProviderConfigRequirement[] = [
  { key: 'TELEGRAM_BOT_TOKEN', label: 'Telegram Bot Token', required: true },
]
