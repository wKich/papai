import { afterAll, describe, test, expect, beforeEach, mock } from 'bun:test'

import { mockDrizzle, mockLogger, setupTestDb } from '../utils/test-helpers.js'

// Mock at the drizzle level (not persistence) to avoid mock pollution
mockLogger()
mockDrizzle()

afterAll(() => {
  mock.restore()
})

import { cacheMessage, getCachedMessage, hasCachedMessage, clearMessageCache } from '../../src/message-cache/cache.js'

describe('Message Cache', () => {
  beforeEach(async () => {
    clearMessageCache()
    await setupTestDb()
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

    const retrieved = getCachedMessage('chat-456', '123')
    expect(retrieved).toBeDefined()
    expect(retrieved?.text).toBe('Hello')
  })

  test('should return undefined for non-existent message', () => {
    const result = getCachedMessage('chat-1', 'non-existent')
    expect(result).toBeUndefined()
  })

  test('should store messages in cache', () => {
    expect(hasCachedMessage('c1', '1')).toBe(false)
    cacheMessage({ messageId: '1', contextId: 'c1', timestamp: Date.now() })
    expect(hasCachedMessage('c1', '1')).toBe(true)
  })

  test('should check if message is cached', () => {
    cacheMessage({ messageId: '1', contextId: 'c1', timestamp: Date.now() })
    expect(hasCachedMessage('c1', '1')).toBe(true)
    expect(hasCachedMessage('c1', '2')).toBe(false)
  })

  test('should isolate messages by contextId', () => {
    cacheMessage({ messageId: '1', contextId: 'chat-A', text: 'From A', timestamp: Date.now() })
    cacheMessage({ messageId: '1', contextId: 'chat-B', text: 'From B', timestamp: Date.now() })

    const fromA = getCachedMessage('chat-A', '1')
    const fromB = getCachedMessage('chat-B', '1')

    expect(fromA?.text).toBe('From A')
    expect(fromB?.text).toBe('From B')
  })
})
