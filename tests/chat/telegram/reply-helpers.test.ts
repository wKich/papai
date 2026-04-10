/**
 * Tests for Telegram reply helpers
 */

import { beforeEach, describe, expect, test } from 'bun:test'

import type { Context } from 'grammy'

import { createReplyParamsBuilder, type ReplyParamsBuilder } from '../../../src/chat/telegram/reply-helpers.js'
import { mockLogger } from '../../utils/test-helpers.js'

/** Create mock Context with message for tests */
function createMockContext(message: {
  message_id: number | undefined
  message_thread_id: number | undefined
}): Context {
  return { message } as unknown as Context
}

describe('createReplyParamsBuilder', () => {
  beforeEach(() => {
    mockLogger()
  })

  test('should handle explicit threadId parameter', () => {
    const ctx = createMockContext({
      message_id: 123,
      message_thread_id: undefined,
    })

    const builder: ReplyParamsBuilder = createReplyParamsBuilder(ctx, '456')
    const params = builder()

    expect(params).toEqual({
      message_id: 123,
      message_thread_id: 456,
    })
  })

  test('should use context threadId when no explicit threadId provided', () => {
    const ctx = createMockContext({
      message_id: 123,
      message_thread_id: 789,
    })

    const builder: ReplyParamsBuilder = createReplyParamsBuilder(ctx)
    const params = builder()

    expect(params).toEqual({
      message_id: 123,
      message_thread_id: 789,
    })
  })

  test('should prioritize explicit threadId over context threadId', () => {
    const ctx = createMockContext({
      message_id: 123,
      message_thread_id: 789,
    })

    const builder: ReplyParamsBuilder = createReplyParamsBuilder(ctx, '456')
    const params = builder()

    expect(params).toEqual({
      message_id: 123,
      message_thread_id: 456,
    })
  })

  test('should handle options.threadId as fallback', () => {
    const ctx = createMockContext({
      message_id: 123,
      message_thread_id: undefined,
    })

    const builder: ReplyParamsBuilder = createReplyParamsBuilder(ctx)
    const params = builder({ threadId: '999' })

    expect(params).toEqual({
      message_id: 123,
      message_thread_id: 999,
    })
  })

  test('should handle options.replyToMessageId', () => {
    const ctx = createMockContext({
      message_id: 123,
      message_thread_id: 789,
    })

    const builder: ReplyParamsBuilder = createReplyParamsBuilder(ctx, '456')
    const params = builder({ replyToMessageId: '999' })

    expect(params).toEqual({
      message_id: 999,
      message_thread_id: 456,
    })
  })

  test('should return undefined when no message_id exists', () => {
    const ctx = createMockContext({
      message_id: undefined,
      message_thread_id: 789,
    })

    const builder: ReplyParamsBuilder = createReplyParamsBuilder(ctx)
    const params = builder()

    expect(params).toBeUndefined()
  })
})
