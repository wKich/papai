import { afterAll, beforeEach, describe, expect, mock, test } from 'bun:test'

import { mockDrizzle, mockLogger, setupTestDb } from '../utils/test-helpers.js'

mockLogger()
mockDrizzle()

afterAll(() => {
  mock.restore()
})

import { buildReplyChain, cacheMessage, clearMessageCache } from '../../src/message-cache/index.js'

describe('Message Cache Integration', () => {
  beforeEach(async () => {
    clearMessageCache()
    await setupTestDb()
  })

  test('should cache telegram-style messages and build chain', () => {
    cacheMessage({
      messageId: '100',
      contextId: 'chat-1',
      authorId: 'user-1',
      authorUsername: 'alice',
      text: 'Original message',
      timestamp: Date.now(),
    })

    cacheMessage({
      messageId: '101',
      contextId: 'chat-1',
      authorId: 'user-2',
      authorUsername: 'bob',
      text: 'Reply to alice',
      replyToMessageId: '100',
      timestamp: Date.now(),
    })

    cacheMessage({
      messageId: '102',
      contextId: 'chat-1',
      authorId: 'user-1',
      authorUsername: 'alice',
      text: 'Reply to bob',
      replyToMessageId: '101',
      timestamp: Date.now(),
    })

    const result = buildReplyChain('102')
    expect(result.chain).toEqual(['100', '101', '102'])
    expect(result.isComplete).toBe(true)
  })

  test('should handle deep chains', () => {
    for (let i = 0; i < 10; i++) {
      cacheMessage({
        messageId: String(i),
        contextId: 'chat-1',
        authorId: 'user-1',
        text: `Message ${i}`,
        replyToMessageId: i > 0 ? String(i - 1) : undefined,
        timestamp: Date.now(),
      })
    }

    const result = buildReplyChain('9')
    expect(result.chain).toHaveLength(10)
    expect(result.chain[0]).toBe('0')
    expect(result.chain[9]).toBe('9')
    expect(result.isComplete).toBe(true)
  })

  test('should handle partial chain with gap in middle', () => {
    // Cache messages 0, 1, 3, 4 but NOT 2
    cacheMessage({ messageId: '0', contextId: 'chat-1', timestamp: Date.now() })
    cacheMessage({ messageId: '1', contextId: 'chat-1', replyToMessageId: '0', timestamp: Date.now() })
    // Message 2 is missing
    cacheMessage({ messageId: '3', contextId: 'chat-1', replyToMessageId: '2', timestamp: Date.now() })
    cacheMessage({ messageId: '4', contextId: 'chat-1', replyToMessageId: '3', timestamp: Date.now() })

    const result = buildReplyChain('4')
    expect(result.chain).toEqual(['3', '4'])
    expect(result.isComplete).toBe(false)
    expect(result.brokenAt).toBe('2')
  })
})
