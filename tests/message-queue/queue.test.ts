import { describe, expect, it, beforeEach, mock } from 'bun:test'

import type { IncomingFile, ReplyFn } from '../../src/chat/types.js'
import { MessageQueue } from '../../src/message-queue/queue.js'
import type { CoalescedItem, QueueItem } from '../../src/message-queue/types.js'
import { mockLogger } from '../utils/logger-mock.js'

const createMockFile = (fileId: string): IncomingFile => ({
  fileId,
  filename: 'test.txt',
  content: Buffer.from('test'),
})

function createReplyFn(typingSpy: ReturnType<typeof mock>): ReplyFn {
  return {
    text: (): Promise<void> => Promise.resolve(),
    formatted: (): Promise<void> => Promise.resolve(),
    file: (): Promise<void> => Promise.resolve(),
    typing: typingSpy,
    buttons: (): Promise<void> => Promise.resolve(),
  }
}

describe('MessageQueue', () => {
  let queue: MessageQueue
  let typingSpy: ReturnType<typeof mock>
  let mockReply: ReplyFn

  beforeEach(() => {
    mockLogger()
    queue = new MessageQueue('user123')
    typingSpy = mock(() => {})
    mockReply = createReplyFn(typingSpy)
  })

  describe('enqueue', () => {
    it('should buffer a single item', () => {
      const item: QueueItem = {
        text: 'Hello',
        userId: 'user123',
        username: 'alice',
        storageContextId: 'user123',
        contextType: 'dm',
        files: [],
      }
      queue.enqueue(item, mockReply)
      expect(queue.getBufferedCount()).toBe(1)
    })

    it('should show typing indicator immediately when message arrives', () => {
      const item: QueueItem = {
        text: 'Hello',
        userId: 'user123',
        username: 'alice',
        storageContextId: 'user123',
        contextType: 'dm',
        files: [],
      }
      queue.enqueue(item, mockReply)
      expect(typingSpy).toHaveBeenCalledTimes(1)
    })

    it('should buffer multiple items', () => {
      queue.enqueue(
        {
          text: 'First',
          userId: 'user123',
          username: 'alice',
          storageContextId: 'user123',
          contextType: 'dm',
          files: [],
        },
        mockReply,
      )
      queue.enqueue(
        {
          text: 'Second',
          userId: 'user123',
          username: 'alice',
          storageContextId: 'user123',
          contextType: 'dm',
          files: [],
        },
        mockReply,
      )
      expect(queue.getBufferedCount()).toBe(2)
    })
  })

  describe('coalescing', () => {
    it('should use last message reply function for coalesced result', () => {
      const reply1 = createReplyFn(typingSpy)
      const reply2 = createReplyFn(typingSpy)

      queue.enqueue(
        {
          text: 'First message',
          userId: 'user123',
          username: 'alice',
          storageContextId: 'user123',
          contextType: 'dm',
          files: [],
        },
        reply1,
      )
      queue.enqueue(
        {
          text: 'Second message',
          userId: 'user123',
          username: 'alice',
          storageContextId: 'user123',
          contextType: 'dm',
          files: [],
        },
        reply2,
      )

      const flushed = queue.forceFlush()
      expect(flushed).not.toBeNull()
      if (flushed === null) {
        throw new Error('Expected flushed to not be null')
      }
      // Reply should be from the last message, not the first
      expect(flushed.reply).toBe(reply2)
    })

    it('should coalesce DM messages with double newline separator', () => {
      queue.enqueue(
        {
          text: 'First message',
          userId: 'user123',
          username: 'alice',
          storageContextId: 'user123',
          contextType: 'dm',
          files: [],
        },
        mockReply,
      )
      queue.enqueue(
        {
          text: 'Second message',
          userId: 'user123',
          username: 'alice',
          storageContextId: 'user123',
          contextType: 'dm',
          files: [],
        },
        mockReply,
      )

      const flushed = queue.forceFlush()
      expect(flushed).not.toBeNull()
      if (flushed === null) {
        throw new Error('Expected flushed to not be null')
      }
      expect(flushed.text).toBe('First message\n\nSecond message')
      expect(flushed.userId).toBe('user123')
      expect(flushed.username).toBe('alice')
      expect(flushed.storageContextId).toBe('user123')
    })

    it('should coalesce group main messages with single newline separator', () => {
      const groupQueue = new MessageQueue('group123')
      queue = groupQueue
      const reply1 = createReplyFn(typingSpy)
      const reply2 = createReplyFn(typingSpy)

      queue.enqueue(
        {
          text: 'First',
          userId: 'user123',
          username: 'alice',
          storageContextId: 'group123',
          contextType: 'group',
          files: [],
        },
        reply1,
      )
      queue.enqueue(
        {
          text: 'Second',
          userId: 'user123',
          username: 'alice',
          storageContextId: 'group123',
          contextType: 'group',
          files: [],
        },
        reply2,
      )

      const flushed = queue.forceFlush()
      expect(flushed).not.toBeNull()
      if (flushed === null) {
        throw new Error('Expected flushed to not be null')
      }
      expect(flushed.text).toBe('First\nSecond')
    })

    it('should add username attribution in thread context', () => {
      const threadQueue = new MessageQueue('thread_abc')
      queue = threadQueue

      queue.enqueue(
        {
          text: 'Hello from thread',
          userId: 'user123',
          username: 'alice',
          storageContextId: 'thread_abc',
          contextType: 'group',
          files: [],
        },
        mockReply,
      )

      const flushed = queue.forceFlush()
      expect(flushed).not.toBeNull()
      if (flushed === null) {
        throw new Error('Expected flushed to not be null')
      }
      expect(flushed.text).toBe('[@alice]: Hello from thread')
    })

    it('should accumulate files from all messages', () => {
      const file1 = createMockFile('file1')
      const file2 = createMockFile('file2')

      queue.enqueue(
        {
          text: 'First',
          userId: 'user123',
          username: 'alice',
          storageContextId: 'user123',
          contextType: 'dm',
          files: [file1],
        },
        mockReply,
      )
      queue.enqueue(
        {
          text: 'Second',
          userId: 'user123',
          username: 'alice',
          storageContextId: 'user123',
          contextType: 'dm',
          files: [file2],
        },
        mockReply,
      )

      const flushed = queue.forceFlush()
      expect(flushed).not.toBeNull()
      if (flushed === null) {
        throw new Error('Expected flushed to not be null')
      }
      expect(flushed.files).toHaveLength(2)
      expect(flushed.files[0]!.fileId).toBe('file1')
      expect(flushed.files[1]!.fileId).toBe('file2')
    })
  })

  describe('forceFlush', () => {
    it('should return null when queue is empty', () => {
      const flushed = queue.forceFlush()
      expect(flushed).toBeNull()
    })

    it('should clear buffered items after flush', () => {
      queue.enqueue(
        {
          text: 'Hello',
          userId: 'user123',
          username: 'alice',
          storageContextId: 'user123',
          contextType: 'dm',
          files: [],
        },
        mockReply,
      )

      queue.forceFlush()
      expect(queue.getBufferedCount()).toBe(0)
    })

    it('should clear the timer on force flush', () => {
      queue.enqueue(
        {
          text: 'Hello',
          userId: 'user123',
          username: 'alice',
          storageContextId: 'user123',
          contextType: 'dm',
          files: [],
        },
        mockReply,
      )

      queue.forceFlush()
    })
  })

  describe('empty state', () => {
    it('should return 0 for empty queue', () => {
      expect(queue.getBufferedCount()).toBe(0)
    })
  })

  describe('handler invocation', () => {
    it('should call handler on timer flush', async () => {
      const handlerCalls: string[] = []
      const handler = async (coalesced: CoalescedItem): Promise<void> => {
        handlerCalls.push(coalesced.text)
        await Promise.resolve()
      }

      queue.setHandler(handler)
      queue.enqueue(
        {
          text: 'Hello',
          userId: 'user123',
          username: 'alice',
          storageContextId: 'user123',
          contextType: 'dm',
          files: [],
        },
        mockReply,
      )

      // Wait for debounce timer (500ms)
      await new Promise((r) => {
        setTimeout(r, 550)
      })

      expect(handlerCalls.length).toBe(1)
      expect(handlerCalls[0]).toBe('Hello')
    })

    it('should handle errors from handler gracefully', async () => {
      let handlerCallCount = 0
      const handler = async (_coalesced: CoalescedItem): Promise<void> => {
        handlerCallCount++
        await Promise.resolve()
        throw new Error('Handler failed')
      }

      queue.setHandler(handler)
      queue.enqueue(
        {
          text: 'Hello',
          userId: 'user123',
          username: 'alice',
          storageContextId: 'user123',
          contextType: 'dm',
          files: [],
        },
        mockReply,
      )

      // Wait for debounce timer - should not throw
      await new Promise((r) => {
        setTimeout(r, 550)
      })

      expect(handlerCallCount).toBe(1)
    })

    it('should not call handler when queue is empty', async () => {
      const handlerCalls: string[] = []
      const handler = async (coalesced: CoalescedItem): Promise<void> => {
        handlerCalls.push(coalesced.text)
        await Promise.resolve()
      }

      queue.setHandler(handler)
      // Don't enqueue anything, just wait

      await new Promise((r) => {
        setTimeout(r, 550)
      })

      expect(handlerCalls.length).toBe(0)
    })
  })

  describe('different user in main group chat', () => {
    it('should flush immediately when different user sends message in group main', () => {
      const groupQueue = new MessageQueue('group123')
      queue = groupQueue

      queue.enqueue(
        {
          text: 'Hello from alice',
          userId: 'user1',
          username: 'alice',
          storageContextId: 'group123',
          contextType: 'group',
          files: [],
        },
        mockReply,
      )

      expect(queue.getBufferedCount()).toBe(1)

      const flushed = queue.enqueue(
        {
          text: 'Hello from bob',
          userId: 'user2',
          username: 'bob',
          storageContextId: 'group123',
          contextType: 'group',
          files: [],
        },
        mockReply,
      )

      expect(flushed).not.toBeNull()
      if (flushed === null) {
        throw new Error('Expected flushed to not be null')
      }
      expect(flushed.text).toBe('Hello from alice')
      expect(queue.getBufferedCount()).toBe(1)
    })

    it('should not flush when same user sends multiple messages', () => {
      const groupQueue = new MessageQueue('group123')
      queue = groupQueue

      const flushed1 = queue.enqueue(
        {
          text: 'First from alice',
          userId: 'user1',
          username: 'alice',
          storageContextId: 'group123',
          contextType: 'group',
          files: [],
        },
        mockReply,
      )

      const flushed2 = queue.enqueue(
        {
          text: 'Second from alice',
          userId: 'user1',
          username: 'alice',
          storageContextId: 'group123',
          contextType: 'group',
          files: [],
        },
        mockReply,
      )

      expect(flushed1).toBeNull()
      expect(flushed2).toBeNull()
      expect(queue.getBufferedCount()).toBe(2)
    })

    it('should not flush in thread even with different users', () => {
      const threadQueue = new MessageQueue('thread_abc')
      queue = threadQueue

      queue.enqueue(
        {
          text: 'First',
          userId: 'user1',
          username: 'alice',
          storageContextId: 'thread_abc',
          contextType: 'group',
          files: [],
        },
        mockReply,
      )

      const flushed = queue.enqueue(
        {
          text: 'Second',
          userId: 'user2',
          username: 'bob',
          storageContextId: 'thread_abc',
          contextType: 'group',
          files: [],
        },
        mockReply,
      )

      expect(flushed).toBeNull()
      expect(queue.getBufferedCount()).toBe(2)
    })
  })
})
