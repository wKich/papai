import { afterAll, beforeEach, describe, expect, mock, test } from 'bun:test'

import { clearMessageCache, mockLogger, mockMessageCache } from '../utils/test-helpers.js'

mockLogger()
mockMessageCache()

afterAll(() => {
  mock.restore()
})

import { cacheMessage } from '../../src/message-cache/cache.js'
import { buildReplyChain } from '../../src/message-cache/chain.js'

describe('Reply Chain Builder', () => {
  beforeEach(() => {
    clearMessageCache()
  })

  test('should build linear chain', () => {
    // A -> B -> C
    cacheMessage({ messageId: 'A', contextId: 'c1', timestamp: Date.now() })
    cacheMessage({ messageId: 'B', contextId: 'c1', replyToMessageId: 'A', timestamp: Date.now() })
    cacheMessage({ messageId: 'C', contextId: 'c1', replyToMessageId: 'B', timestamp: Date.now() })

    const result = buildReplyChain('c1', 'C')
    expect(result.chain).toEqual(['A', 'B', 'C'])
    expect(result.isComplete).toBe(true)
  })

  test('should detect missing parent', () => {
    cacheMessage({ messageId: 'C', contextId: 'c1', replyToMessageId: 'B', timestamp: Date.now() })

    const result = buildReplyChain('c1', 'C')
    expect(result.chain).toEqual(['C'])
    expect(result.isComplete).toBe(false)
    expect(result.brokenAt).toBe('B')
  })

  test('should detect circular reference', () => {
    cacheMessage({ messageId: 'A', contextId: 'c1', replyToMessageId: 'C', timestamp: Date.now() })
    cacheMessage({ messageId: 'B', contextId: 'c1', replyToMessageId: 'A', timestamp: Date.now() })
    cacheMessage({ messageId: 'C', contextId: 'c1', replyToMessageId: 'B', timestamp: Date.now() })

    const result = buildReplyChain('c1', 'C')
    expect(result.chain).toEqual(['A', 'B', 'C'])
    expect(result.isComplete).toBe(false)
  })

  test('should handle single message (no replies)', () => {
    cacheMessage({ messageId: 'A', contextId: 'c1', timestamp: Date.now() })

    const result = buildReplyChain('c1', 'A')
    expect(result.chain).toEqual(['A'])
    expect(result.isComplete).toBe(true)
  })

  test('should handle non-existent starting message', () => {
    const result = buildReplyChain('c1', 'non-existent')
    expect(result.chain).toEqual([])
    expect(result.isComplete).toBe(false)
    expect(result.brokenAt).toBe('non-existent')
  })
})
