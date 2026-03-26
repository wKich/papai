import { scheduleMessagePersistence } from './persistence.js'
import type { CachedMessage } from './types.js'

// In-memory cache: messageId -> CachedMessage
const messageCache = new Map<string, CachedMessage>()

// 1 week in milliseconds
const ONE_WEEK_MS = 7 * 24 * 60 * 60 * 1000

export function cacheMessage(message: CachedMessage): void {
  messageCache.set(message.messageId, message)
  scheduleMessagePersistence(message)
}

export function getCachedMessage(messageId: string): CachedMessage | undefined {
  const cached = messageCache.get(messageId)
  if (cached === undefined) return undefined

  // Check TTL (1 week)
  const now = Date.now()
  if (now - cached.timestamp > ONE_WEEK_MS) {
    messageCache.delete(messageId)
    return undefined
  }

  return cached
}

/** @public */
export function hasCachedMessage(messageId: string): boolean {
  return getCachedMessage(messageId) !== undefined
}

/** @public */
export function clearMessageCache(): void {
  messageCache.clear()
}
