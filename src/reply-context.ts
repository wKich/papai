import type { IncomingMessage } from './chat/types.js'
import { logger } from './logger.js'
import { buildReplyChain, getCachedMessage } from './message-cache/index.js'

const log = logger.child({ scope: 'reply-context' })

/**
 * Builds chain and summary from cached messages for a reply.
 * Uses the shared message-cache infrastructure (in-memory + SQLite).
 */
export function buildReplyContextChain(
  contextId: string,
  replyToMessageId: string,
): { chain?: string[]; chainSummary?: string } {
  const result = buildReplyChain(contextId, replyToMessageId)

  if (result.chain.length <= 1) {
    return {}
  }

  // Build summary from earlier messages (exclude the last = immediate parent, already shown in replyContext.text)
  const earlierMessages = result.chain.slice(0, -1)
  const summaries: string[] = []

  for (const msgId of earlierMessages) {
    const msg = getCachedMessage(contextId, msgId)
    if (msg === undefined || msg.text === undefined || msg.text === '') continue
    const author = msg.authorUsername ?? 'user'
    summaries.push(`${author}: ${msg.text}`)
  }

  return {
    chain: result.chain,
    chainSummary: summaries.length > 0 ? summaries.join(' → ') : undefined,
  }
}

/**
 * Builds a prompt string with reply context prepended.
 *
 * ReplyContext is already fully populated by platform providers:
 * - Telegram: reply_to_message fields + message cache chain
 * - Mattermost: cached parent or API fetch + message cache chain
 */
export function buildPromptWithReplyContext(msg: IncomingMessage): string {
  if (msg.replyContext === undefined) {
    return msg.text
  }

  const context: string[] = []

  if (msg.replyContext.text !== undefined) {
    const author = msg.replyContext.authorUsername ?? 'user'
    context.push(`[Replying to message from ${author}: "${msg.replyContext.text}"]`)
  }

  if (msg.replyContext.quotedText !== undefined) {
    context.push(`[Quoted text: "${msg.replyContext.quotedText}"]`)
  }

  if (msg.replyContext.chainSummary !== undefined && msg.replyContext.chainSummary !== '') {
    context.push(`[Earlier context: ${msg.replyContext.chainSummary}]`)
  }

  if (context.length === 0) {
    return msg.text
  }

  log.debug({ contextParts: context.length }, 'Built prompt with reply context')
  return context.join('\n') + '\n\n' + msg.text
}
