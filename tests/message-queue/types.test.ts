import { describe, expect, test } from 'bun:test'

import type { QueueItem, CoalescedItem, QueueState, InternalQueueState } from '../../src/message-queue/types.js'

describe('QueueItem interface', () => {
  test('accepts valid queue item', () => {
    const item: QueueItem = {
      text: 'Hello',
      userId: '123',
      username: 'alice',
      storageContextId: '456',
      contextType: 'dm',
      files: [],
    }
    expect(item.text).toBe('Hello')
    expect(item.storageContextId).toBe('456')
    expect(item.contextType).toBe('dm')
  })
})

describe('CoalescedItem interface', () => {
  test('accepts valid coalesced item', () => {
    const mockReply = {
      text: async (): Promise<void> => {},
      formatted: async (): Promise<void> => {},
      file: async (): Promise<void> => {},
      typing: (): void => {},
      buttons: async (): Promise<void> => {},
    }
    const item: CoalescedItem = {
      text: 'Hello',
      userId: '123',
      username: 'alice',
      storageContextId: '456',
      files: [],
      reply: mockReply,
    }
    expect(item.text).toBe('Hello')
    expect(item.reply).toBe(mockReply)
  })
})

describe('QueueState interface', () => {
  test('accepts valid queue state', () => {
    const state: QueueState = {
      items: [],
      processing: false,
      timer: null,
      lastUserId: null,
      files: [],
    }
    expect(state.processing).toBe(false)
    expect(state.timer).toBeNull()
  })
})

describe('InternalQueueState interface', () => {
  test('accepts valid internal state', () => {
    const state: InternalQueueState = {
      items: [],
      processing: false,
      timer: null,
      lastUserId: null,
      files: [],
      replies: [],
    }
    expect(state.replies).toEqual([])
  })
})
