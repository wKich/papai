import { beforeEach, describe, expect, test } from 'bun:test'

import type { IncomingMessage } from '../src/chat/types.js'
import { cacheMessage } from '../src/message-cache/cache.js'
import { buildPromptWithReplyContext, buildReplyContextChain } from '../src/reply-context.js'
import { clearMessageCache, mockLogger, mockMessageCache } from './utils/test-helpers.js'

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
  beforeEach(() => {
    mockLogger()
    mockMessageCache()
  })

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

  test('includes truncation note when quotedTextTruncated=true', () => {
    const msg = makeDmMessage({
      text: 'Is this the right task?',
      replyContext: {
        messageId: 'msg123',
        authorUsername: 'alice',
        text: 'Full message text here',
        quotedText: 'B'.repeat(1024),
        quotedTextTruncated: true,
      },
    })

    const result = buildPromptWithReplyContext(msg)

    expect(result).toContain('[Quoted text (truncated')
    expect(result).not.toContain('[Quoted text: "')
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

  test('includes attached file metadata in prompt', () => {
    const msg = makeDmMessage({
      text: 'Please upload this',
      files: [
        {
          fileId: 'f1',
          filename: 'report.pdf',
          mimeType: 'application/pdf',
          size: 12345,
          content: Buffer.from(''),
        },
      ],
    })

    const result = buildPromptWithReplyContext(msg)

    expect(result).toContain('upload_attachment')
    expect(result).toContain('fileId=f1: report.pdf (application/pdf, 12345 bytes)')
    expect(result).toContain('Please upload this')
  })

  test('includes multiple files in prompt', () => {
    const msg = makeDmMessage({
      text: 'Two files',
      files: [
        { fileId: 'f1', filename: 'a.txt', mimeType: 'text/plain', size: 100, content: Buffer.from('') },
        { fileId: 'f2', filename: 'b.png', mimeType: 'image/png', size: 200, content: Buffer.from('') },
      ],
    })

    const result = buildPromptWithReplyContext(msg)

    expect(result).toContain('fileId=f1: a.txt (text/plain, 100 bytes)')
    expect(result).toContain('fileId=f2: b.png (image/png, 200 bytes)')
  })

  test('omits size from file metadata when size is undefined', () => {
    const msg = makeDmMessage({
      text: 'file',
      files: [{ fileId: 'f1', filename: 'photo.jpg', mimeType: 'image/jpeg', content: Buffer.from('') }],
    })

    const result = buildPromptWithReplyContext(msg)

    expect(result).toContain('fileId=f1: photo.jpg (image/jpeg)')
    expect(result).not.toContain('bytes')
  })

  test('includes file metadata alongside reply context', () => {
    const msg = makeDmMessage({
      text: 'Here it is',
      replyContext: { messageId: 'prev', authorUsername: 'alice', text: 'Can you send the file?' },
      files: [{ fileId: 'f1', filename: 'doc.pdf', content: Buffer.from('') }],
    })

    const result = buildPromptWithReplyContext(msg)

    expect(result).toContain('[Replying to message from alice:')
    expect(result).toContain('fileId=f1: doc.pdf')
    expect(result).toContain('Here it is')
  })

  test('returns plain text when no reply context and no files', () => {
    const msg = makeDmMessage({ text: 'Just text' })
    expect(buildPromptWithReplyContext(msg)).toBe('Just text')
  })
})

describe('buildReplyContextChain', () => {
  beforeEach(() => {
    mockLogger()
    mockMessageCache()
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
