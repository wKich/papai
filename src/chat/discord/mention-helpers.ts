import type { ContextType } from '../types.js'

/** Strip the leading `<@botId>` or `<@!botId>` mention from a Discord message content and trim. */
export function stripBotMention(content: string, botId: string): string {
  const pattern = new RegExp(`^<@!?${RegExp.escape(botId)}>\\s*`)
  return content.replace(pattern, '').trim()
}

/**
 * Returns true if the Discord message should be treated as an @mention of the bot.
 * DMs are always considered mentions (parity with Telegram/Mattermost DM semantics).
 * Group channels match `<@botId>` or `<@!botId>` substrings.
 */
export function isBotMentioned(content: string, botId: string, contextType: ContextType): boolean {
  if (contextType === 'dm') return true
  return content.includes(`<@${botId}>`) || content.includes(`<@!${botId}>`)
}
