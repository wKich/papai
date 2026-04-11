import { describe, expect, it } from 'bun:test'
import type { QueueItem } from '../../src/message-queue/types.js'

describe('QueueItem interface', () => {
  it('should accept valid queue item', () => {
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
