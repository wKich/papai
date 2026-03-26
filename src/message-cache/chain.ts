import { logger } from '../logger.js'
import { getCachedMessage } from './cache.js'

const log = logger.child({ scope: 'message-cache:chain' })

export interface ReplyChainResult {
  chain: string[]
  isComplete: boolean
  brokenAt?: string
}

/** @public */
export function buildReplyChain(messageId: string, visited: Set<string> = new Set()): ReplyChainResult {
  const chain: string[] = []
  let currentId: string | undefined = messageId
  let isComplete = true
  let brokenAt: string | undefined

  while (currentId !== undefined) {
    // Cycle detection
    if (visited.has(currentId)) {
      log.error({ messageId: currentId, chain }, 'Circular reference detected in reply chain')
      isComplete = false
      brokenAt = currentId
      break
    }

    visited.add(currentId)

    const message = getCachedMessage(currentId)
    if (message === undefined) {
      // Message not in cache - chain is broken
      isComplete = false
      brokenAt = currentId
      log.warn({ messageId: currentId }, 'Message not in cache, stopping chain build')
      break
    }

    chain.push(currentId)

    if (message.replyToMessageId === undefined) {
      // Reached root message
      break
    }

    currentId = message.replyToMessageId
  }

  // Return in chronological order (oldest first)
  return {
    chain: chain.reverse(),
    isComplete,
    brokenAt,
  }
}
