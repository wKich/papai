import { beforeEach, describe, test } from 'bun:test'

import type { ReplyFn } from '../../src/chat/types.js'
import type { QueueItem } from '../../src/message-queue/types.js'
import { mockLogger } from '../utils/test-helpers.js'

type MessageQueueModule = Pick<typeof import('../../src/message-queue/index.js'), 'enqueueMessage' | 'flushOnShutdown'>

function isMessageQueueModule(value: unknown): value is MessageQueueModule {
  return (
    typeof value === 'object' &&
    value !== null &&
    'enqueueMessage' in value &&
    typeof value.enqueueMessage === 'function' &&
    'flushOnShutdown' in value &&
    typeof value.flushOnShutdown === 'function'
  )
}

async function loadMessageQueueModule(): Promise<MessageQueueModule> {
  const module: unknown = await import(`../../src/message-queue/index.js?test=${crypto.randomUUID()}`)

  if (!isMessageQueueModule(module)) {
    throw new TypeError('Failed to load message queue module')
  }

  return module
}

describe('enqueueMessage', () => {
  beforeEach(() => {
    mockLogger()
  })

  test('should enqueue without error', async () => {
    const { enqueueMessage } = await loadMessageQueueModule()
    const item: QueueItem = {
      text: 'Hello',
      userId: '123',
      username: 'alice',
      storageContextId: `ctx1-${crypto.randomUUID()}`,
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

    enqueueMessage(item, mockReply, async () => {})
  })
})

describe('flushOnShutdown', () => {
  test('should flush without error', async () => {
    const { flushOnShutdown } = await loadMessageQueueModule()

    await flushOnShutdown({ timeoutMs: 1000 })
  })
})
