import type { ChatCapability, ChatProviderConfigRequirement, ChatProviderTraits } from '../types.js'

export const discordCapabilities: ReadonlySet<ChatCapability> = new Set<ChatCapability>([
  'interactions.callbacks',
  'messages.buttons',
  'messages.redact',
  'messages.reply-context',
  'users.resolve',
])

export const discordTraits: ChatProviderTraits = {
  observedGroupMessages: 'mentions_only',
  maxMessageLength: 2000,
  callbackDataMaxLength: 100,
}

export const discordConfigRequirements: readonly ChatProviderConfigRequirement[] = [
  { key: 'DISCORD_BOT_TOKEN', label: 'Discord Bot Token', required: true },
]
