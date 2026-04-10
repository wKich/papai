/**
 * Tests for Telegram forum topic helpers
 */

import { beforeEach, describe, expect, test } from 'bun:test'

import type { Context } from 'grammy'

import { createForumTopicIfNeeded } from '../../../src/chat/telegram/forum-topic-helpers.js'
import { mockLogger } from '../../utils/test-helpers.js'

/** Mock API interface */
interface MockApi {
  getChat: (_chatId: number) => Promise<{ is_forum: boolean }>
  createForumTopic: (_chatId: number, _name: string) => Promise<{ message_thread_id: number }>
}

/** Create mock Context for testing */
function createMockContext(overrides: { chatType?: string; threadId?: number; username?: string } = {}): Context {
  const { chatType = 'supergroup', threadId, username = 'testuser' } = overrides
  return {
    chat: { type: chatType, id: 123456 },
    message: { message_thread_id: threadId },
    from: { username },
  } as unknown as Context
}

describe('createForumTopicIfNeeded', () => {
  beforeEach(() => {
    mockLogger()
  })

  test('returns existing threadId if already in thread', async () => {
    const ctx = createMockContext({ threadId: 999 })

    const mockApi: MockApi = {
      getChat: async () => Promise.resolve({ is_forum: true }),
      createForumTopic: async () => Promise.resolve({ message_thread_id: 111 }),
    }

    const result = await createForumTopicIfNeeded(ctx, mockApi)

    expect(result).toBe('999')
  })

  test('returns undefined for non-supergroup chat', async () => {
    const ctx = createMockContext({ chatType: 'group' })

    const mockApi: MockApi = {
      getChat: async () => Promise.resolve({ is_forum: true }),
      createForumTopic: async () => Promise.resolve({ message_thread_id: 111 }),
    }

    const result = await createForumTopicIfNeeded(ctx, mockApi)

    expect(result).toBeUndefined()
  })

  test('returns undefined for non-forum supergroup', async () => {
    const ctx = createMockContext()

    const mockApi: MockApi = {
      getChat: async () => Promise.resolve({ is_forum: false }),
      createForumTopic: async () => Promise.resolve({ message_thread_id: 111 }),
    }

    const result = await createForumTopicIfNeeded(ctx, mockApi)

    expect(result).toBeUndefined()
  })

  test('creates forum topic when conditions met', async () => {
    const ctx = createMockContext()

    const mockApi: MockApi = {
      getChat: async () => Promise.resolve({ is_forum: true }),
      createForumTopic: async () => Promise.resolve({ message_thread_id: 111 }),
    }

    const result = await createForumTopicIfNeeded(ctx, mockApi)

    expect(result).toBe('111')
  })

  test('handles missing username gracefully', async () => {
    const ctx = createMockContext({ username: undefined })

    const mockApi: MockApi = {
      getChat: async () => Promise.resolve({ is_forum: true }),
      createForumTopic: async () => Promise.resolve({ message_thread_id: 111 }),
    }

    const result = await createForumTopicIfNeeded(ctx, mockApi)

    expect(result).toBe('111')
  })

  test('returns undefined on API error', async () => {
    const ctx = createMockContext()

    const mockApi: MockApi = {
      getChat: async () => Promise.resolve({ is_forum: true }),
      createForumTopic: async () => Promise.reject(new Error('API Error')),
    }

    const result = await createForumTopicIfNeeded(ctx, mockApi)

    expect(result).toBeUndefined()
  })
})
