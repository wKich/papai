import { scheduleMessagePersistence } from './persistence.js'
import type { CachedMessage } from './types.js'

// In-memory cache: "contextId:messageId" -> CachedMessage
const messageCache = new Map<string, CachedMessage>()

// 1 week in milliseconds
const ONE_WEEK_MS = 7 * 24 * 60 * 60 * 1000

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

/** @public */
export function hasCachedMessage(contextId: string, messageId: string): boolean {
  return getCachedMessage(contextId, messageId) !== undefined
}

/** @public */
export function clearMessageCache(): void {
  messageCache.clear()
}
