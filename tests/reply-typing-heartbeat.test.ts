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
})
