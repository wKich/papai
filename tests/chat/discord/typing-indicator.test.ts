import { beforeEach, describe, expect, test } from 'bun:test'

import { withTypingIndicator } from '../../../src/chat/discord/typing-indicator.js'
import { mockLogger } from '../../utils/test-helpers.js'

describe('withTypingIndicator', () => {
  beforeEach(() => {
    mockLogger()
  })

  test('calls sendTyping immediately and returns the fn result', async () => {
    const calls: number[] = []
    const channel = {
      sendTyping: (): Promise<void> => {
        calls.push(Date.now())
        return Promise.resolve()
      },
    }
    const result = await withTypingIndicator(channel, () => Promise.resolve('computed'))
    expect(result).toBe('computed')
    expect(calls.length).toBeGreaterThanOrEqual(1)
  })

  test('propagates errors from the inner fn', async () => {
    const channel = { sendTyping: (): Promise<void> => Promise.resolve() }
    await expect(
      withTypingIndicator(channel, () => {
        throw new Error('inner failure')
      }),
    ).rejects.toThrow('inner failure')
  })

  test('swallows sendTyping errors', async () => {
    const channel = {
      sendTyping: (): Promise<void> => Promise.reject(new Error('403 Forbidden')),
    }
    const result = await withTypingIndicator(channel, () => Promise.resolve('ok'))
    expect(result).toBe('ok')
  })
})
