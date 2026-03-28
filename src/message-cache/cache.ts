import { logger } from '../logger.js'
import { scheduleMessagePersistence } from './persistence.js'
import type { CachedMessage } from './types.js'

const log = logger.child({ scope: 'message-cache' })

// In-memory cache: "contextId:messageId" -> CachedMessage
const messageCache = new Map<string, CachedMessage>()

// 1 week in milliseconds
const ONE_WEEK_MS = 7 * 24 * 60 * 60 * 1000

/** Sweep expired entries from the in-memory message cache. */
export function sweepExpiredMessages(): void {
  const now = Date.now()
  let swept = 0
  for (const [key, msg] of messageCache) {
    if (now - msg.timestamp > ONE_WEEK_MS) {
      messageCache.delete(key)
      swept++
    }
  }
  if (swept > 0) {
    log.info({ swept, remaining: messageCache.size }, 'Swept expired message cache entries')
  }
}

function cacheKey(contextId: string, messageId: string): string {
  return `${contextId}:${messageId}`
}

export function cacheMessage(message: CachedMessage): void {
  messageCache.set(cacheKey(message.contextId, message.messageId), message)
  scheduleMessagePersistence(message)
}

export function getCachedMessage(contextId: string, messageId: string): CachedMessage | undefined {
  const cached = messageCache.get(cacheKey(contextId, messageId))
  if (cached === undefined) return undefined

  // Check TTL (1 week)
  const now = Date.now()
  if (now - cached.timestamp > ONE_WEEK_MS) {
    messageCache.delete(cacheKey(contextId, messageId))
    return undefined
  }

  return cached
}
