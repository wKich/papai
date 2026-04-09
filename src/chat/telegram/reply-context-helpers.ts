import { buildReplyContextChain } from '../../reply-context.js'
import type { ReplyContext } from '../types.js'

/** Minimal interface for extractReplyContext input. Matches grammy Context structure. */
interface ExtractReplyContextInput {
  message?: {
    message_id?: number
    text?: string
    message_thread_id?: number
    reply_to_message?: {
      message_id?: number
      from?: { id?: number; username?: string } | undefined
      text?: string
    }
    quote?: { text?: string }
  }
}

/** Extract reply context from a Telegram message. Exported for testing. */
export function extractReplyContext(ctx: ExtractReplyContextInput, contextId: string): ReplyContext | undefined {
  const replyToMessage = ctx.message?.reply_to_message
  const replyToMessageId = replyToMessage?.message_id
  if (replyToMessage === undefined || replyToMessageId === undefined) return undefined

  const idStr = String(replyToMessageId)
  const quote = ctx.message?.quote
  const { chain, chainSummary } = buildReplyContextChain(contextId, idStr)
  const fromId = replyToMessage.from?.id
  const threadId = ctx.message?.message_thread_id

  return {
    messageId: idStr,
    authorId: fromId === undefined ? undefined : String(fromId),
    authorUsername: replyToMessage.from?.username ?? null,
    text: replyToMessage.text,
    quotedText: quote?.text,
    threadId: threadId === undefined ? undefined : String(threadId),
    chain,
    chainSummary,
  }
}
