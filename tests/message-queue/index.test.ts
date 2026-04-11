import { describe, test, beforeEach } from 'bun:test'

import type { ReplyFn } from '../../src/chat/types.js'
import { enqueueMessage, flushOnShutdown } from '../../src/message-queue/index.js'
import type { QueueItem } from '../../src/message-queue/types.js'
import { mockLogger } from '../utils/test-helpers.js'

describe('enqueueMessage', () => {
  beforeEach(() => {
    mockLogger()
  })

  test('should enqueue without error', () => {
    const item: QueueItem = {
      text: 'Hello',
      userId: '123',
      username: 'alice',
      storageContextId: 'ctx1',
      contextType: 'dm',
      files: [],
    }
    const mockReply: ReplyFn = {
      text: async () => {},
      formatted: async () => {},
      file: async () => {},
      typing: () => {},
      buttons: async () => {},
    }

    // Should not throw
    enqueueMessage(item, mockReply, async () => {})
  })
})

describe('flushOnShutdown', () => {
  test('should flush without error', async () => {
    await flushOnShutdown({ timeoutMs: 1000 })
  })
})
