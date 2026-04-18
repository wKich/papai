import { beforeEach, describe, expect, test } from 'bun:test'

import type { ReplyFn } from '../src/chat/types.js'
import { withReplyTypingHeartbeat } from '../src/reply-typing-heartbeat.js'
import { mockLogger } from './utils/test-helpers.js'

function wait(ms: number): Promise<void> {
  return new Promise((resolve) => {
    setTimeout(resolve, ms)
  })
}

function createReply(typingCalls: number[], textCalls: string[]): ReplyFn {
  return {
    text: (content: string): Promise<void> => {
      textCalls.push(content)
      return Promise.resolve()
    },
    formatted: (content: string): Promise<void> => {
      textCalls.push(content)
      return Promise.resolve()
    },
    typing: (): void => {
      typingCalls.push(Date.now())
    },
    buttons: (): Promise<void> => Promise.resolve(),
  }
}

describe('reply typing heartbeat', () => {
  beforeEach(() => {
    mockLogger()
  })

  test('keeps refreshing typing until the wrapped work completes', async () => {
    const typingCalls: number[] = []
    const textCalls: string[] = []
    const reply = createReply(typingCalls, textCalls)

    await withReplyTypingHeartbeat(
      reply,
      async () => {
        await wait(55)

        expect(typingCalls.length).toBeGreaterThanOrEqual(2)
        expect(textCalls).toHaveLength(0)
      },
      { intervalMs: 20 },
    )

    const callCountAfterStop = typingCalls.length
    await wait(35)

    expect(typingCalls).toHaveLength(callCountAfterStop)
  })

  test('stops refreshing typing after sending a reply', async () => {
    const typingCalls: number[] = []
    const textCalls: string[] = []
    const reply = createReply(typingCalls, textCalls)

    await withReplyTypingHeartbeat(
      reply,
      async (wrappedReply) => {
        await wait(25)
        const callCountBeforeReply = typingCalls.length

        await wrappedReply.text('done')
        await wait(35)

        expect(textCalls).toEqual(['done'])
        expect(typingCalls).toHaveLength(callCountBeforeReply)
      },
      { intervalMs: 20 },
    )
  })

  test('handles initial typing error gracefully and continues execution', async () => {
    const typingCalls: number[] = []
    const textCalls: string[] = []
    let shouldThrow = true
    const reply: ReplyFn = {
      text: (content: string): Promise<void> => {
        textCalls.push(content)
        return Promise.resolve()
      },
      formatted: (content: string): Promise<void> => {
        textCalls.push(content)
        return Promise.resolve()
      },
      // Cast to handle both sync and async typing signatures
      typing: ((): unknown => {
        if (shouldThrow) {
          shouldThrow = false
          return Promise.reject(new Error('Typing failed'))
        }
        typingCalls.push(Date.now())
        return Promise.resolve()
      }) as () => void,
      buttons: (): Promise<void> => Promise.resolve(),
    }

    await withReplyTypingHeartbeat(
      reply,
      async (wrappedReply) => {
        await wait(25)
        // Should have retried typing after initial failure
        expect(typingCalls.length).toBeGreaterThanOrEqual(1)
        await wrappedReply.text('done')
      },
      { intervalMs: 20 },
    )

    expect(textCalls).toEqual(['done'])
  })

  test('handles recurring typing errors gracefully', async () => {
    const typingCalls: number[] = []
    const textCalls: string[] = []
    let callCount = 0
    const reply: ReplyFn = {
      text: (content: string): Promise<void> => {
        textCalls.push(content)
        return Promise.resolve()
      },
      formatted: (content: string): Promise<void> => {
        textCalls.push(content)
        return Promise.resolve()
      },
      // Cast to handle both sync and async typing signatures
      typing: ((): unknown => {
        callCount++
        if (callCount <= 2) {
          return Promise.reject(new Error('Typing failed'))
        }
        typingCalls.push(Date.now())
        return Promise.resolve()
      }) as () => void,
      buttons: (): Promise<void> => Promise.resolve(),
    }

    await withReplyTypingHeartbeat(
      reply,
      async (wrappedReply) => {
        await wait(50)
        // Should continue despite errors and eventually succeed
        expect(typingCalls.length).toBeGreaterThanOrEqual(1)
        await wrappedReply.text('done')
      },
      { intervalMs: 20 },
    )

    expect(textCalls).toEqual(['done'])
  })

  test('handles synchronous typing errors', async () => {
    const textCalls: string[] = []
    const reply: ReplyFn = {
      text: (content: string): Promise<void> => {
        textCalls.push(content)
        return Promise.resolve()
      },
      formatted: (content: string): Promise<void> => {
        textCalls.push(content)
        return Promise.resolve()
      },
      typing: (): void => {
        // Synchronous throw (not a Promise)
        throw new Error('Sync typing error')
      },
      buttons: (): Promise<void> => Promise.resolve(),
    }

    // Should not throw despite sync error from typing
    await withReplyTypingHeartbeat(
      reply,
      async (wrappedReply) => {
        await wrappedReply.text('done')
      },
      { intervalMs: 20 },
    )

    expect(textCalls).toEqual(['done'])
  })

  test('handles async typing that resolves successfully', async () => {
    const typingCalls: number[] = []
    const textCalls: string[] = []
    const reply: ReplyFn = {
      text: (content: string): Promise<void> => {
        textCalls.push(content)
        return Promise.resolve()
      },
      formatted: (content: string): Promise<void> => {
        textCalls.push(content)
        return Promise.resolve()
      },
      // Cast to handle both sync and async typing signatures
      typing: ((): unknown => {
        typingCalls.push(Date.now())
        return Promise.resolve()
      }) as () => void,
      buttons: (): Promise<void> => Promise.resolve(),
    }

    await withReplyTypingHeartbeat(
      reply,
      async (wrappedReply) => {
        await wait(25)
        expect(typingCalls.length).toBeGreaterThanOrEqual(1)
        await wrappedReply.text('done')
      },
      { intervalMs: 20 },
    )

    expect(textCalls).toEqual(['done'])
  })
})
