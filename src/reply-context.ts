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
 * Builds a prompt string with reply context and file metadata prepended.
 *
 * ReplyContext is already fully populated by platform providers:
 * - Telegram: reply_to_message fields + message cache chain
 * - Mattermost: cached parent or API fetch + message cache chain
 */
function hasContextData(msg: IncomingMessage): boolean {
  const hasReplyContext = msg.replyContext !== undefined
  const hasFiles = msg.files !== undefined && msg.files.length > 0
  return hasReplyContext || hasFiles
}

function logReplyContextDebug(msg: IncomingMessage): void {
  if (msg.replyContext === undefined) return
  const replyTextLength = msg.replyContext.text?.length ?? 0
  const quotedTextLength = msg.replyContext.quotedText?.length ?? 0
  const hasChainSummary = msg.replyContext.chainSummary !== undefined && msg.replyContext.chainSummary !== ''

  log.debug(
    {
      messageId: msg.messageId,
      replyToMessageId: msg.replyContext.messageId,
      replyTextLength,
      quotedTextLength,
      hasChainSummary,
      replyTextPreview: msg.replyContext.text?.slice(0, 100),
      quotedTextPreview: msg.replyContext.quotedText?.slice(0, 100),
    },
    'Building prompt with reply context',
  )
}

function buildReplyContextLines(msg: IncomingMessage): string[] {
  const lines: string[] = []
  if (msg.replyContext === undefined) return lines

  if (msg.replyContext.text !== undefined) {
    const author = msg.replyContext.authorUsername ?? 'user'
    lines.push(`[Replying to message from ${author}: "${msg.replyContext.text}"]`)
  }

  if (msg.replyContext.quotedText !== undefined) {
    const label =
      msg.replyContext.quotedTextTruncated === true
        ? 'Quoted text (truncated — see full message in reply context above)'
        : 'Quoted text'
    lines.push(`[${label}: "${msg.replyContext.quotedText}"]`)
  }

  if (msg.replyContext.chainSummary !== undefined && msg.replyContext.chainSummary !== '') {
    lines.push(`[Earlier context: ${msg.replyContext.chainSummary}]`)
  }
  return lines
}

function buildFileContextLine(msg: IncomingMessage): string | null {
  if (msg.files === undefined || msg.files.length === 0) return null
  const fileList = msg.files
    .map((f) => {
      const meta: string[] = []
      if (f.mimeType !== undefined) meta.push(f.mimeType)
      if (f.size !== undefined) meta.push(`${f.size} bytes`)
      const fileLabel = meta.length > 0 ? `${f.filename} (${meta.join(', ')})` : f.filename
      return `fileId=${f.fileId}: ${fileLabel}`
    })
    .join('; ')
  return `[Attached files available for upload_attachment (use fileId): ${fileList}]`
}

function logPromptBuilt(contextLength: number, finalPrompt: string, originalText: string): void {
  log.debug(
    {
      contextParts: contextLength,
      finalPromptLength: finalPrompt.length,
      originalMessageLength: originalText.length,
    },
    'Built prompt with reply context',
  )
}

export function buildPromptWithReplyContext(msg: IncomingMessage): string {
  if (!hasContextData(msg)) {
    return msg.text
  }

  const context: string[] = []

  if (msg.replyContext !== undefined) {
    logReplyContextDebug(msg)
    context.push(...buildReplyContextLines(msg))
  }

  const fileLine = buildFileContextLine(msg)
  if (fileLine !== null) {
    context.push(fileLine)
  }

  if (context.length === 0) {
    return msg.text
  }

  const finalPrompt = context.join('\n') + '\n\n' + msg.text
  logPromptBuilt(context.length, finalPrompt, msg.text)
  return finalPrompt
}
