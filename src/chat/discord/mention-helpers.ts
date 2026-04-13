import type { ContextType } from '../types.js'

/** Strip the leading `<@botId>` or `<@!botId>` mention from a Discord message content and trim. */
export function stripBotMention(content: string, botId: string): string {
  const pattern = new RegExp(`^<@!?${RegExp.escape(botId)}>\\s*`)
  return content.replace(pattern, '').trim()
}

/** Minimal type for Discord.js MessageMentions.has() method. */
export type MentionsLike = {
  has: (id: string) => boolean
}

/**
 * Returns true if the Discord message should be treated as an @mention of the bot.
 * DMs are always considered mentions (parity with Telegram/Mattermost DM semantics).
 * Group channels use Discord's mentions.has() API for accurate mention detection.
 */
export function isBotMentioned(mentions: MentionsLike, botId: string, contextType: ContextType): boolean {
  if (contextType === 'dm') return true
  return mentions.has(botId)
}
