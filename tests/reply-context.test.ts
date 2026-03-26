import { afterAll, beforeEach, describe, expect, mock, test } from 'bun:test'

import type { IncomingMessage } from '../src/chat/types.js'
import { clearMessageCache, mockLogger, mockMessageCache } from './utils/test-helpers.js'

mockLogger()
mockMessageCache()

afterAll(() => {
  mock.restore()
})

import { cacheMessage } from '../src/message-cache/cache.js'
import { buildPromptWithReplyContext, buildReplyContextChain } from '../src/reply-context.js'

function makeDmMessage(overrides: Partial<IncomingMessage> = {}): IncomingMessage {
  return {
    user: { id: 'user1', username: 'testuser', isAdmin: false },
    contextId: 'ctx1',
    contextType: 'dm',
    isMentioned: false,
    text: 'Hello world',
    ...overrides,
  }
}

describe('buildPromptWithReplyContext', () => {
  test('returns plain text when no reply context', () => {
    const msg = makeDmMessage({ text: 'Hello world' })
    expect(buildPromptWithReplyContext(msg)).toBe('Hello world')
  })

  test('includes parent message context', () => {
    const msg = makeDmMessage({
      text: 'Can you update it?',
      replyContext: {
        messageId: 'msg123',
        authorUsername: 'otheruser',
        text: 'Task #123 needs review',
      },
    })

    const result = buildPromptWithReplyContext(msg)

    expect(result).toContain('[Replying to message from otheruser:')
    expect(result).toContain('Task #123 needs review')
    expect(result).toContain('Can you update it?')
  })

  test('includes quoted text', () => {
    const msg = makeDmMessage({
      text: 'This part is important',
      replyContext: {
        messageId: 'msg123',
        quotedText: 'Important detail here',
      },
    })

    const result = buildPromptWithReplyContext(msg)

    expect(result).toContain('[Quoted text: "Important detail here"]')
  })

  test('includes chain summary', () => {
    const msg = makeDmMessage({
      text: 'Follow-up question',
      replyContext: {
        messageId: 'msg3',
        authorUsername: 'bob',
        text: 'Second message',
        chainSummary: 'alice: First message',
      },
    })

    const result = buildPromptWithReplyContext(msg)

    expect(result).toContain('[Earlier context: alice: First message]')
    expect(result).toContain('[Replying to message from bob:')
    expect(result).toContain('Follow-up question')
  })

  test('truncates long parent messages', () => {
    const longText = 'a'.repeat(300)
    const msg = makeDmMessage({
      text: 'Short question',
      replyContext: {
        messageId: 'msg123',
        authorUsername: 'user',
        text: longText,
      },
    })

    const result = buildPromptWithReplyContext(msg)

    expect(result).toContain('...')
    expect(result.length).toBeLessThan(longText.length + 100)
  })

  test('falls back to "user" when authorUsername is missing', () => {
    const msg = makeDmMessage({
      text: 'Reply',
      replyContext: {
        messageId: 'msg123',
        text: 'Original',
      },
    })

    const result = buildPromptWithReplyContext(msg)

    expect(result).toContain('[Replying to message from user:')
  })
})

describe('buildReplyContextChain', () => {
  beforeEach(() => {
    clearMessageCache()
  })

  test('returns empty when chain has only one message', () => {
    cacheMessage({
      messageId: 'A',
      contextId: 'ctx1',
      text: 'Root message',
      timestamp: Date.now(),
    })

    const result = buildReplyContextChain('ctx1', 'A')

    expect(result.chain).toBeUndefined()
    expect(result.chainSummary).toBeUndefined()
  })

  test('builds chain summary for multi-message chain', () => {
    cacheMessage({ messageId: 'A', contextId: 'ctx1', authorUsername: 'alice', text: 'First', timestamp: Date.now() })
    cacheMessage({
      messageId: 'B',
      contextId: 'ctx1',
      authorUsername: 'bob',
      text: 'Second',
      replyToMessageId: 'A',
      timestamp: Date.now(),
    })
    cacheMessage({
      messageId: 'C',
      contextId: 'ctx1',
      authorUsername: 'alice',
      text: 'Third',
      replyToMessageId: 'B',
      timestamp: Date.now(),
    })

    const result = buildReplyContextChain('ctx1', 'C')

    expect(result.chain).toEqual(['A', 'B', 'C'])
    expect(result.chainSummary).toContain('alice: First')
    expect(result.chainSummary).toContain('bob: Second')
  })

  test('returns undefined chainSummary when earlier messages not cached', () => {
    cacheMessage({
      messageId: 'C',
      contextId: 'ctx1',
      text: 'Third',
      replyToMessageId: 'B',
      timestamp: Date.now(),
    })

    const result = buildReplyContextChain('ctx1', 'C')

    expect(result.chain).toBeUndefined()
    expect(result.chainSummary).toBeUndefined()
  })

  test('chain summary excludes the immediate parent', () => {
    cacheMessage({ messageId: 'A', contextId: 'ctx1', authorUsername: 'alice', text: 'Root', timestamp: Date.now() })
    cacheMessage({
      messageId: 'B',
      contextId: 'ctx1',
      authorUsername: 'bob',
      text: 'Parent',
      replyToMessageId: 'A',
      timestamp: Date.now(),
    })

    const result = buildReplyContextChain('ctx1', 'B')

    expect(result.chain).toEqual(['A', 'B'])
    // Summary should only include A (alice), not B (bob) which is the immediate parent
    expect(result.chainSummary).toBe('alice: Root')
    expect(result.chainSummary).not.toContain('bob')
  })
})
