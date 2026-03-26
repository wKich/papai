import { describe, test, expect, beforeEach } from 'bun:test'

import {
  cacheMessage,
  getCachedMessage,
  hasCachedMessage,
  clearMessageCache,
  getMessageCacheSize,
} from '../../src/message-cache/cache.js'

describe('Message Cache', () => {
  beforeEach(() => {
    clearMessageCache()
  })

  test('should cache and retrieve message', () => {
    const message = {
      messageId: '123',
      contextId: 'chat-456',
      authorId: 'user-789',
      text: 'Hello',
      timestamp: Date.now(),
    }

    cacheMessage(message)

    const retrieved = getCachedMessage('123')
    expect(retrieved).toBeDefined()
    expect(retrieved?.text).toBe('Hello')
  })

  test('should return undefined for non-existent message', () => {
    const result = getCachedMessage('non-existent')
    expect(result).toBeUndefined()
  })

  test('should track cache size', () => {
    expect(getMessageCacheSize()).toBe(0)
    cacheMessage({ messageId: '1', contextId: 'c1', timestamp: Date.now() })
    expect(getMessageCacheSize()).toBe(1)
  })

  test('should check if message is cached', () => {
    cacheMessage({ messageId: '1', contextId: 'c1', timestamp: Date.now() })
    expect(hasCachedMessage('1')).toBe(true)
    expect(hasCachedMessage('2')).toBe(false)
  })
})
