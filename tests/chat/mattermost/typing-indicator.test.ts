import { beforeEach, describe, expect, test } from 'bun:test'

import { withTypingIndicator } from '../../../src/chat/mattermost/typing-indicator.js'
import { mockLogger } from '../../utils/test-helpers.js'

describe('withTypingIndicator', () => {
  beforeEach(() => {
    mockLogger()
  })

  test('sends user_typing immediately and returns the fn result', async () => {
    const calls: Array<{ seq: number; action: string; data: Record<string, unknown> }> = []
    let seq = 1
    const getWsSeq = (): number => seq++
    const wsSend = (message: { seq: number; action: string; data: Record<string, unknown> }): void => {
      calls.push(message)
    }

    const result = await withTypingIndicator('channel-123', getWsSeq, wsSend, () => Promise.resolve('computed'))

    expect(result).toBe('computed')
    expect(calls.length).toBeGreaterThanOrEqual(1)
    expect(calls[0]).toEqual({
      seq: 1,
      action: 'user_typing',
      data: { channel_id: 'channel-123' },
    })
  })

  test('propagates errors from the inner fn', async () => {
    let seq = 1
    const getWsSeq = (): number => seq++
    const wsSend = (): void => {}

    await expect(
      withTypingIndicator('channel-123', getWsSeq, wsSend, () => {
        throw new Error('inner failure')
      }),
    ).rejects.toThrow('inner failure')
  })

  test('swallows wsSend errors', async () => {
    let seq = 1
    const getWsSeq = (): number => seq++
    const wsSend = (): void => {
      throw new Error('WebSocket error')
    }

    const result = await withTypingIndicator('channel-123', getWsSeq, wsSend, () => Promise.resolve('ok'))

    expect(result).toBe('ok')
  })

  test('sends multiple user_typing events over time', async () => {
    const calls: Array<{ seq: number; action: string; data: Record<string, unknown> }> = []
    let seq = 1
    const getWsSeq = (): number => seq++
    const wsSend = (message: { seq: number; action: string; data: Record<string, unknown> }): void => {
      calls.push(message)
    }

    // Use a delayed promise to allow interval to fire
    await withTypingIndicator('channel-123', getWsSeq, wsSend, () => {
      return new Promise((resolve) => {
        setTimeout(() => resolve('done'), 4700)
      })
    })

    // Should have sent initial + at least one more during the delay
    // Interval is 4500ms, so we expect 2 calls
    expect(calls.length).toBeGreaterThanOrEqual(2)
    expect(calls[0]).toEqual({
      seq: 1,
      action: 'user_typing',
      data: { channel_id: 'channel-123' },
    })
    const lastCall = calls[calls.length - 1]
    expect(lastCall?.action).toBe('user_typing')
    expect(lastCall?.data).toEqual({ channel_id: 'channel-123' })
    expect(typeof lastCall?.seq).toBe('number')
  }, 10000)
})
