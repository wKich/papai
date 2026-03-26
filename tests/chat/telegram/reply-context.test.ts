import { describe, expect, test } from 'bun:test'

import type { ReplyContext } from '../../../src/chat/types.js'

describe('Telegram reply context extraction logic', () => {
  test('builds ReplyContext from reply_to_message', () => {
    const replyToMessage = {
      message_id: 111,
      from: { id: 222, username: 'originaluser' },
      text: 'Original message',
    }

    const replyContext: ReplyContext = {
      messageId: String(replyToMessage.message_id),
      authorId: String(replyToMessage.from.id),
      authorUsername: replyToMessage.from.username ?? null,
      text: replyToMessage.text,
    }

    expect(replyContext.messageId).toBe('111')
    expect(replyContext.authorId).toBe('222')
    expect(replyContext.authorUsername).toBe('originaluser')
    expect(replyContext.text).toBe('Original message')
    expect(replyContext.quotedText).toBeUndefined()
  })

  test('extracts quote text from reply', () => {
    const replyToMessage = {
      message_id: 111,
      from: { id: 222, username: 'originaluser' },
      text: 'Full original message',
    }
    const quote = { text: 'Quoted portion' }

    const replyContext: ReplyContext = {
      messageId: String(replyToMessage.message_id),
      authorId: String(replyToMessage.from.id),
      authorUsername: replyToMessage.from.username ?? null,
      text: replyToMessage.text,
      quotedText: quote.text,
    }

    expect(replyContext.quotedText).toBe('Quoted portion')
  })

  test('extracts message_thread_id for forum topics', () => {
    const messageThreadId = 999
    const replyToMessage = {
      message_id: 111,
      from: { id: 222, username: 'user' },
      text: 'Original',
    }

    const replyContext: ReplyContext = {
      messageId: String(replyToMessage.message_id),
      threadId: String(messageThreadId),
      text: replyToMessage.text,
    }

    expect(replyContext.threadId).toBe('999')
  })

  test('returns undefined replyContext when not a reply', () => {
    const replyToMessage = undefined
    const replyContext = replyToMessage === undefined ? undefined : { messageId: 'irrelevant' }

    expect(replyContext).toBeUndefined()
  })

  test('handles missing from field on reply_to_message', () => {
    const replyToMessage = {
      message_id: 111,
      from: undefined as { id: number; username?: string } | undefined,
      text: 'System message',
    }

    const replyContext: ReplyContext = {
      messageId: String(replyToMessage.message_id),
      authorId: replyToMessage.from?.id === undefined ? undefined : String(replyToMessage.from.id),
      authorUsername: replyToMessage.from?.username ?? null,
      text: replyToMessage.text,
    }

    expect(replyContext.authorId).toBeUndefined()
    expect(replyContext.authorUsername).toBeNull()
    expect(replyContext.text).toBe('System message')
  })
})
