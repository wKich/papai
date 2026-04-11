import { describe, expect, mock, test, beforeEach } from 'bun:test'

import type { IncomingFile, ReplyFn } from '../../src/chat/types.js'
import { enqueueMessage, flushOnShutdown } from '../../src/message-queue/index.js'
import type { CoalescedItem } from '../../src/message-queue/types.js'
import { mockLogger } from '../utils/test-helpers.js'

const delay = (ms: number): Promise<void> =>
  new Promise((r) => {
    setTimeout(r, ms)
  })

describe('MessageQueue Integration', () => {
  beforeEach(() => {
    mockLogger()
  })

  test('should process messages sequentially per context', async () => {
    const processed: string[] = []
    const mockReply: ReplyFn = {
      text: async (): Promise<void> => {},
      formatted: async (): Promise<void> => {},
      file: async (): Promise<void> => {},
      typing: (): void => {},
      buttons: async (): Promise<void> => {},
    }

    const handler = async (coalesced: CoalescedItem): Promise<void> => {
      processed.push(coalesced.text)
      // Simulate async work
      await delay(10)
    }

    // Send two messages to same context
    enqueueMessage(
      {
        text: 'Message 1',
        userId: 'user1',
        username: 'alice',
        storageContextId: 'ctx1',
        contextType: 'dm',
        files: [],
      },
      mockReply,
      handler,
    )

    enqueueMessage(
      {
        text: 'Message 2',
        userId: 'user1',
        username: 'alice',
        storageContextId: 'ctx1',
        contextType: 'dm',
        files: [],
      },
      mockReply,
      handler,
    )

    // Wait for debounce + processing
    await delay(600)

    // Should be coalesced into one
    expect(processed.length).toBe(1)
    expect(processed[0]).toBe('Message 1\n\nMessage 2')
  })

  test('should accumulate files from multiple messages', async () => {
    const fileResults: IncomingFile[] = []
    const mockReply: ReplyFn = {
      text: async (): Promise<void> => {},
      formatted: async (): Promise<void> => {},
      file: async (): Promise<void> => {},
      typing: (): void => {},
      buttons: async (): Promise<void> => {},
    }

    const handler = async (coalesced: CoalescedItem): Promise<void> => {
      fileResults.push(...coalesced.files)
      await Promise.resolve()
    }

    const file1: IncomingFile = { fileId: '1', filename: 'a.jpg', content: Buffer.from('a') }
    const file2: IncomingFile = { fileId: '2', filename: 'b.jpg', content: Buffer.from('b') }

    enqueueMessage(
      {
        text: 'First',
        userId: 'user1',
        username: 'alice',
        storageContextId: 'ctx1',
        contextType: 'dm',
        files: [file1],
      },
      mockReply,
      handler,
    )

    enqueueMessage(
      {
        text: 'Second',
        userId: 'user1',
        username: 'alice',
        storageContextId: 'ctx1',
        contextType: 'dm',
        files: [file2],
      },
      mockReply,
      handler,
    )

    await delay(600)

    expect(fileResults.length).toBe(2)
    expect(fileResults[0]?.filename).toBe('a.jpg')
    expect(fileResults[1]?.filename).toBe('b.jpg')
  })

  test('should flush on shutdown', async () => {
    const processed: string[] = []
    const mockReply: ReplyFn = {
      text: async (): Promise<void> => {},
      formatted: async (): Promise<void> => {},
      file: async (): Promise<void> => {},
      typing: (): void => {},
      buttons: async (): Promise<void> => {},
    }

    const handler = async (coalesced: CoalescedItem): Promise<void> => {
      processed.push(coalesced.text)
      await Promise.resolve()
    }

    enqueueMessage(
      {
        text: 'Pending',
        userId: 'user1',
        username: 'alice',
        storageContextId: 'ctx1',
        contextType: 'dm',
        files: [],
      },
      mockReply,
      handler,
    )

    // Don't wait for debounce - call flush directly
    await flushOnShutdown({ timeoutMs: 1000 })

    expect(processed.length).toBe(1)
    expect(processed[0]).toBe('Pending')
  })

  test('should process different contexts concurrently without blocking', async () => {
    const processed: string[] = []
    const typingSpy = mock(() => {})

    const mockReply1: ReplyFn = {
      text: async (): Promise<void> => {},
      formatted: async (): Promise<void> => {},
      file: async (): Promise<void> => {},
      typing: typingSpy,
      buttons: async (): Promise<void> => {},
    }

    const mockReply2: ReplyFn = {
      text: async (): Promise<void> => {},
      formatted: async (): Promise<void> => {},
      file: async (): Promise<void> => {},
      typing: typingSpy,
      buttons: async (): Promise<void> => {},
    }

    const handler1 = async (coalesced: CoalescedItem): Promise<void> => {
      processed.push(`ctx1: ${coalesced.text}`)
      await Promise.resolve()
    }

    const handler2 = async (coalesced: CoalescedItem): Promise<void> => {
      processed.push(`ctx2: ${coalesced.text}`)
      await Promise.resolve()
    }

    // Send message to context 1
    enqueueMessage(
      {
        text: 'Message for ctx1',
        userId: 'user1',
        username: 'alice',
        storageContextId: 'ctx1',
        contextType: 'dm',
        files: [],
      },
      mockReply1,
      handler1,
    )

    // Send message to context 2
    enqueueMessage(
      {
        text: 'Message for ctx2',
        userId: 'user2',
        username: 'bob',
        storageContextId: 'ctx2',
        contextType: 'dm',
        files: [],
      },
      mockReply2,
      handler2,
    )

    // Both contexts should process independently
    await delay(600)

    expect(processed.length).toBe(2)
    expect(processed).toContain('ctx1: Message for ctx1')
    expect(processed).toContain('ctx2: Message for ctx2')
  })

  test('should keep contexts isolated - messages do not interleave', async () => {
    const ctx1Results: string[] = []
    const ctx2Results: string[] = []
    const typingSpy = mock(() => {})

    const createMockReply = (): ReplyFn => ({
      text: async (): Promise<void> => {},
      formatted: async (): Promise<void> => {},
      file: async (): Promise<void> => {},
      typing: typingSpy,
      buttons: async (): Promise<void> => {},
    })

    const handler1 = async (coalesced: CoalescedItem): Promise<void> => {
      ctx1Results.push(coalesced.text)
      await Promise.resolve()
    }

    const handler2 = async (coalesced: CoalescedItem): Promise<void> => {
      ctx2Results.push(coalesced.text)
      await Promise.resolve()
    }

    // Interleave messages to different contexts
    enqueueMessage(
      { text: 'A1', userId: 'u1', username: 'a', storageContextId: 'ctx1', contextType: 'dm', files: [] },
      createMockReply(),
      handler1,
    )

    enqueueMessage(
      { text: 'B1', userId: 'u2', username: 'b', storageContextId: 'ctx2', contextType: 'dm', files: [] },
      createMockReply(),
      handler2,
    )

    enqueueMessage(
      { text: 'A2', userId: 'u1', username: 'a', storageContextId: 'ctx1', contextType: 'dm', files: [] },
      createMockReply(),
      handler1,
    )

    enqueueMessage(
      { text: 'B2', userId: 'u2', username: 'b', storageContextId: 'ctx2', contextType: 'dm', files: [] },
      createMockReply(),
      handler2,
    )

    await delay(600)

    // Each context should have its own coalesced message
    expect(ctx1Results.length).toBe(1)
    expect(ctx1Results[0]).toBe('A1\n\nA2')

    expect(ctx2Results.length).toBe(1)
    expect(ctx2Results[0]).toBe('B1\n\nB2')
  })

  test('should flush multiple contexts on shutdown', async () => {
    const processed: string[] = []
    const typingSpy = mock(() => {})

    const createMockReply = (): ReplyFn => ({
      text: async (): Promise<void> => {},
      formatted: async (): Promise<void> => {},
      file: async (): Promise<void> => {},
      typing: typingSpy,
      buttons: async (): Promise<void> => {},
    })

    const handler = async (coalesced: CoalescedItem): Promise<void> => {
      processed.push(`${coalesced.storageContextId}: ${coalesced.text}`)
      await Promise.resolve()
    }

    // Enqueue to multiple contexts
    enqueueMessage(
      { text: 'Msg1', userId: 'u1', username: 'a', storageContextId: 'ctxA', contextType: 'dm', files: [] },
      createMockReply(),
      handler,
    )

    enqueueMessage(
      { text: 'Msg2', userId: 'u2', username: 'b', storageContextId: 'ctxB', contextType: 'dm', files: [] },
      createMockReply(),
      handler,
    )

    enqueueMessage(
      { text: 'Msg3', userId: 'u3', username: 'c', storageContextId: 'ctxC', contextType: 'dm', files: [] },
      createMockReply(),
      handler,
    )

    // Flush all on shutdown
    await flushOnShutdown({ timeoutMs: 1000 })

    expect(processed.length).toBe(3)
    expect(processed).toContain('ctxA: Msg1')
    expect(processed).toContain('ctxB: Msg2')
    expect(processed).toContain('ctxC: Msg3')
  })
})
