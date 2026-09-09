// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

import { beforeEach, describe, expect, mock, test } from 'bun:test'
import assert from 'node:assert/strict'

import {
  buildFormattedChunksForTelegram,
  chunkForTelegram,
  type DeferredTelegramSendOptions,
} from '../../../src/chat/telegram/format-chunking.js'
import { createTrackedLoggerMock, mockLogger, type TrackedLoggerMock } from '../../utils/test-helpers.js'

describe('chunkForTelegram', () => {
  test('returns a single chunk for input shorter than the budget', () => {
    expect(chunkForTelegram('short text', 4096)).toEqual(['short text'])
  })

  test('returns single-element array for empty input', () => {
    expect(chunkForTelegram('', 4096)).toEqual([''])
  })

  test('handles exactly-budget input without splitting', () => {
    const input = 'y'.repeat(100)
    expect(chunkForTelegram(input, 100)).toEqual([input])
  })

  test('splits on the last paragraph boundary before the budget', () => {
    const first = 'a'.repeat(1500)
    const second = 'b'.repeat(1500)
    const chunks = chunkForTelegram(`${first}\n\n${second}`, 2000)
    expect(chunks).toEqual([first, second])
  })

  test('prefers the paragraph boundary over an earlier line boundary', () => {
    const chunks = chunkForTelegram('one\ntwo\n\nthree', 12)
    expect(chunks).toEqual(['one\ntwo', 'three'])
  })

  test('splits on the last line boundary when no paragraph break fits', () => {
    const first = 'a'.repeat(50)
    const second = 'b'.repeat(50)
    const chunks = chunkForTelegram(`${first}\n${second}`, 60)
    expect(chunks).toEqual([first, second])
  })

  test('hard-cuts unbroken text at the budget', () => {
    const chunks = chunkForTelegram('x'.repeat(250), 100)
    expect(chunks).toEqual(['x'.repeat(100), 'x'.repeat(100), 'x'.repeat(50)])
  })

  test('nudges a hard cut left when it would split a surrogate pair', () => {
    const head = 'a'.repeat(5)
    const input = head + '😀'.repeat(4)
    const chunks = chunkForTelegram(input, 10)
    expect(chunks).toEqual([head + '😀'.repeat(2), '😀'.repeat(2)])
  })

  test('keeps a hard cut between astral characters unnudged', () => {
    const chunks = chunkForTelegram('😀'.repeat(10), 8)
    expect(chunks).toEqual(['😀'.repeat(4), '😀'.repeat(4), '😀'.repeat(2)])
  })

  test('trims leading boundary newlines from continuation chunks', () => {
    const first = 'a'.repeat(50)
    const second = 'b'.repeat(50)
    const chunks = chunkForTelegram(`${first}\n\n\n${second}`, 60)
    expect(chunks).toEqual([`${first}\n`, second])
    for (const chunk of chunks.slice(1)) {
      expect(chunk.startsWith('\n')).toBe(false)
    }
  })

  test('drops a trailing separator remainder instead of emitting an empty chunk', () => {
    const input = 'a'.repeat(100) + '\n\n'
    expect(chunkForTelegram(input, 100)).toEqual(['a'.repeat(100)])
  })

  test('never returns empty chunks for a zero budget', () => {
    expect(chunkForTelegram('abc', 0)).toEqual(['a', 'b', 'c'])
  })

  test('honours an explicitly reduced budget over the adapter default', () => {
    const first = 'a'.repeat(60)
    const second = 'b'.repeat(60)
    const input = `${first}\n\n${second}`
    expect(chunkForTelegram(input, 4096)).toEqual([input])
    expect(chunkForTelegram(input, 70)).toEqual([first, second])
  })

  test('keeps every chunk within the budget on mixed content', () => {
    const input = 'first paragraph\nwith a second line\n\nemoji 😀 tail\n\n' + 'x'.repeat(120) + '\n\nlast one'
    const chunks = chunkForTelegram(input, 80)
    expect(chunks.length).toBeGreaterThan(1)
    for (const chunk of chunks) {
      expect(chunk.length).toBeLessThanOrEqual(80)
      expect(chunk.length).toBeGreaterThan(0)
      expect(chunk.startsWith('\n')).toBe(false)
    }
    expect(chunks.join('').replace(/\s+/gu, '')).toBe(input.replace(/\s+/gu, ''))
  })
})

describe('buildFormattedChunksForTelegram first-chunk reserve', () => {
  const doubling = (markdown: string): { text: string; entities: never[] } => ({
    text: markdown + markdown,
    entities: [],
  })

  test('returns the whole formatted chunk when it fits together with the reserve', () => {
    const chunks = buildFormattedChunksForTelegram('x'.repeat(2000), doubling, 96)

    expect(chunks).toHaveLength(1)
    expect(chunks[0]?.text.length).toBe(4000)
  })

  test('reduces the first chunk budget by the reserve and re-splits until prefix plus chunk fits', () => {
    const chunks = buildFormattedChunksForTelegram('x'.repeat(6000), doubling, 7)

    expect(chunks.map((chunk) => chunk.text.length)).toEqual([4088, 4088, 2, 3822])
  })

  test('reserves the budget for the first chunk only, not for followers', () => {
    // The follower doubles to 4090: within the full 4096 limit, but over
    // 4089 (limit minus the reserve) — a reserve that leaked past the first
    // chunk would re-split it.
    const markdown = `${'a'.repeat(2044)}\n\n${'c'.repeat(2045)}`
    const chunks = buildFormattedChunksForTelegram(markdown, doubling, 7)

    expect(chunks.map((chunk) => chunk.text.length)).toEqual([4088, 4090])
  })
})

describe('sendDeferredTelegramChunks', () => {
  beforeEach(() => {
    mockLogger()
  })

  // The deferred send loop's logger child binds at module-eval time, so the
  // static import above already captured the real logger. Rows that assert
  // the per-chunk warn install the tracked logger and force a fresh
  // evaluation of the sibling with a cache-busting query (mirrors
  // tests/chat/telegram/reply-helpers.test.ts).
  type DeferredChunkModule = typeof import('../../../src/chat/telegram/format-chunking.js')

  const isDeferredChunkModule = (value: unknown): value is DeferredChunkModule =>
    typeof value === 'object' &&
    value !== null &&
    typeof Reflect.get(value, 'sendDeferredTelegramChunks') === 'function'

  const loadDeferredSend = async (tracked: TrackedLoggerMock): Promise<DeferredChunkModule> => {
    void mock.module('../../../src/logger.js', () => ({
      getLogLevel: tracked.getLogLevel,
      logger: tracked.logger,
    }))
    const loaded: unknown = await import(`../../../src/chat/telegram/format-chunking.js?t=${crypto.randomUUID()}`)
    if (!isDeferredChunkModule(loaded)) {
      throw new Error('format-chunking module did not export the expected shape')
    }
    return loaded
  }

  const alicePrefix = {
    text: '@alice ',
    entities: [
      {
        offset: 0,
        length: 6,
        type: 'text_mention' as const,
        user: { id: 42, is_bot: false, first_name: 'alice' },
      },
    ],
  }

  const makeDeferredSends = (
    behaviors: ReadonlyArray<Promise<unknown>>,
  ): {
    sends: Array<{ text: string; threadId: number | undefined }>
    send: (text: string, options: DeferredTelegramSendOptions) => Promise<unknown>
  } => {
    const sends: Array<{ text: string; threadId: number | undefined }> = []
    const send = (text: string, options: DeferredTelegramSendOptions): Promise<unknown> => {
      const index = sends.length
      sends.push({ text, threadId: options.message_thread_id })
      return behaviors[index] ?? Promise.resolve(undefined)
    }
    return { sends, send }
  }

  const fourChunkMarkdown = ['fail-0', 'fail-1', 'fail-2', 'fail-3']
    .map((label) => `${label} ${'y'.repeat(2200)}`)
    .join('\n\n')

  test('a failed middle chunk warns with chat id and chunk position, still sends later chunks, and rethrows', async () => {
    const tracked = createTrackedLoggerMock()
    const { sendDeferredTelegramChunks: send } = await loadDeferredSend(tracked)
    const chunkError = new Error('telegram deferred send failed')
    const { sends, send: sendFn } = makeDeferredSends([
      Promise.resolve(undefined),
      Promise.reject(chunkError),
      Promise.resolve(undefined),
      Promise.resolve(undefined),
    ])

    const rejection = await send(sendFn, 99, fourChunkMarkdown, alicePrefix, 123).then(
      () => undefined,
      (err: unknown) => err,
    )

    expect(sends.length).toBe(4)
    expect(sends[0]?.text.startsWith('@alice fail-0')).toBe(true)
    expect(sends[1]?.text.startsWith('fail-1')).toBe(true)
    expect(sends.map((sent) => sent.threadId)).toEqual([123, 123, 123, 123])
    expect(rejection).toBe(chunkError)
    const warn = tracked
      .getCallsByLevel('warn')
      .find((call) => call.args[1] === 'Failed to send Telegram deferred chunk')
    expect(warn).toBeDefined()
    assert(warn !== undefined)
    expect(warn.args[0]).toMatchObject({ chatId: 99, chunkIndex: 1, chunkCount: 4 })
  })

  test('the first chunk error is the one rethrown when several chunks fail', async () => {
    const tracked = createTrackedLoggerMock()
    const { sendDeferredTelegramChunks: send } = await loadDeferredSend(tracked)
    const firstError = new Error('first failure')
    const laterError = new Error('later failure')
    const { sends, send: sendFn } = makeDeferredSends([
      Promise.resolve(undefined),
      Promise.reject(firstError),
      Promise.reject(laterError),
      Promise.resolve(undefined),
    ])

    const rejection = await send(sendFn, 99, fourChunkMarkdown, alicePrefix, 123).then(
      () => undefined,
      (err: unknown) => err,
    )

    expect(sends.length).toBe(4)
    expect(rejection).toBe(firstError)
  })
})
