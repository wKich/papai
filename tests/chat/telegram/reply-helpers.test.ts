// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

/**
 * Tests for Telegram reply helpers
 */

import { beforeEach, describe, expect, mock, test } from 'bun:test'
import assert from 'node:assert/strict'

import { InlineKeyboard } from 'grammy'

import { formatLlmOutput } from '../../../src/chat/telegram/format.js'
import {
  type ButtonReplyCapableContext,
  createReplyParamsBuilder,
  type ReplacementReplyContext,
  type ReplyContext,
  type ReplyParamsBuilder,
  type SentButtonMessage,
  sendButtonReply,
  sendFormattedReply,
  sendReplacementButtonReply,
  sendReplacementTextReply,
} from '../../../src/chat/telegram/reply-helpers.js'
import { createTrackedLoggerMock, mockLogger, type TrackedLoggerMock } from '../../utils/test-helpers.js'

/** Create mock Context with message for tests */
function createMockContext(message: {
  message_id: number | undefined
  message_thread_id: number | undefined
}): ReplyContext {
  return { message }
}

type ReplacementCallOptions = Partial<{
  entities: ReturnType<typeof formatLlmOutput>['entities']
  reply_markup: InlineKeyboard
}>

describe('sendFormattedReply link preview', () => {
  beforeEach(() => {
    mockLogger()
  })

  const makeReplyCtx = (): { ctx: ButtonReplyCapableContext; calls: Array<Record<string, unknown> | undefined> } => {
    const calls: Array<Record<string, unknown> | undefined> = []
    const ctx: ButtonReplyCapableContext = {
      reply: (_text: string, opts?: Record<string, unknown>): Promise<SentButtonMessage> => {
        calls.push(opts)
        return Promise.resolve({ message_id: 1, chat: { id: 1 } })
      },
    }
    return { ctx, calls }
  }

  test('omits link_preview_options by default', async () => {
    const { ctx, calls } = makeReplyCtx()
    await sendFormattedReply(ctx, 'hello https://example.com', () => undefined, undefined)
    expect(calls[0]?.['link_preview_options']).toBeUndefined()
  })

  test('disables link preview when disableLinkPreview is set', async () => {
    const { ctx, calls } = makeReplyCtx()
    await sendFormattedReply(ctx, 'hello https://example.com', () => undefined, { disableLinkPreview: true })
    expect(calls[0]?.['link_preview_options']).toEqual({ is_disabled: true })
  })
})

describe('sendFormattedReply returns sent message id', () => {
  beforeEach(() => {
    mockLogger()
  })
  test('returns the sent message id and chat id', async () => {
    const ctx: ButtonReplyCapableContext = {
      reply: (): Promise<SentButtonMessage> => Promise.resolve({ message_id: 42, chat: { id: 7 } }),
    }

    const sent = await sendFormattedReply(ctx, 'hello', () => undefined, undefined)

    expect(sent.messageId).toBe(42)
    expect(sent.chatId).toBe(7)
  })
})

describe('createReplyParamsBuilder', () => {
  beforeEach(() => {
    mockLogger()
  })

  test('should handle explicit threadId parameter', () => {
    const ctx = createMockContext({
      message_id: 123,
      message_thread_id: undefined,
    })

    const builder: ReplyParamsBuilder = createReplyParamsBuilder(ctx, '456')
    const params = builder()

    expect(params).toEqual({
      message_id: 123,
      message_thread_id: 456,
    })
  })

  test('should use context threadId when no explicit threadId provided', () => {
    const ctx = createMockContext({
      message_id: 123,
      message_thread_id: 789,
    })

    const builder: ReplyParamsBuilder = createReplyParamsBuilder(ctx)
    const params = builder()

    expect(params).toEqual({
      message_id: 123,
      message_thread_id: 789,
    })
  })

  test('should prioritize explicit threadId over context threadId', () => {
    const ctx = createMockContext({
      message_id: 123,
      message_thread_id: 789,
    })

    const builder: ReplyParamsBuilder = createReplyParamsBuilder(ctx, '456')
    const params = builder()

    expect(params).toEqual({
      message_id: 123,
      message_thread_id: 456,
    })
  })

  test('should handle options.threadId as fallback', () => {
    const ctx = createMockContext({
      message_id: 123,
      message_thread_id: undefined,
    })

    const builder: ReplyParamsBuilder = createReplyParamsBuilder(ctx)
    const params = builder({ threadId: '999' })

    expect(params).toEqual({
      message_id: 123,
      message_thread_id: 999,
    })
  })

  test('should handle options.replyToMessageId', () => {
    const ctx = createMockContext({
      message_id: 123,
      message_thread_id: 789,
    })

    const builder: ReplyParamsBuilder = createReplyParamsBuilder(ctx, '456')
    const params = builder({ replyToMessageId: '999' })

    expect(params).toEqual({
      message_id: 999,
      message_thread_id: 456,
    })
  })

  test('should return undefined when no message_id exists', () => {
    const ctx = createMockContext({
      message_id: undefined,
      message_thread_id: 789,
    })

    const builder: ReplyParamsBuilder = createReplyParamsBuilder(ctx)
    const params = builder()

    expect(params).toBeUndefined()
  })
})

describe('sendButtonReply returns sent message', () => {
  beforeEach(() => {
    mockLogger()
  })

  test('returns the message object resolved by ctx.reply', async () => {
    const sentMessage: SentButtonMessage = { message_id: 42, chat: { id: 7 } }
    const fakeCtx: ButtonReplyCapableContext = {
      reply: (_text: string, _opts?: Record<string, unknown>): Promise<SentButtonMessage> =>
        Promise.resolve(sentMessage),
    }

    const result = await sendButtonReply(fakeCtx, 'hi', () => undefined, { buttons: [] })

    expect(result.message_id).toBe(42)
  })
})

describe('sendButtonReply content formatting', () => {
  beforeEach(() => {
    mockLogger()
  })

  test('markdown content is converted: no raw asterisks, entities produced', () => {
    const result = formatLlmOutput('**Bold title**\n*(not set)*')
    expect(result.text.includes('**')).toBe(false)
    expect(result.entities.length).toBeGreaterThan(0)
  })

  test('plain text passes through unchanged with no entities', () => {
    const result = formatLlmOutput('Plain text message')
    expect(result.text).toBe('Plain text message')
    expect(result.entities).toHaveLength(0)
  })
})

describe('replacement reply helpers', () => {
  beforeEach(() => {
    mockLogger()
  })

  test('sendReplacementButtonReply edits the callback message with a new keyboard', async () => {
    let capturedText: string | undefined
    let capturedOptions: ReplacementCallOptions | undefined
    const editMessageText = mock((text: string, ...rest: [] | [ReplacementCallOptions]) => {
      const options = rest[0]
      capturedText = text
      capturedOptions = options
      return Promise.resolve(true)
    })
    const ctx: ReplacementReplyContext = { editMessageText }

    await sendReplacementButtonReply(ctx, '**Updated**', {
      buttons: [
        { text: 'First', callbackData: 'first' },
        { text: 'Second', callbackData: 'second' },
        { text: 'Third', callbackData: 'third' },
      ],
    })

    const formatted = formatLlmOutput('**Updated**')

    expect(editMessageText).toHaveBeenCalledTimes(1)

    expect(capturedText).toBe(formatted.text)
    expect(capturedOptions).toBeDefined()
    assert(capturedOptions !== undefined)
    expect(capturedOptions.entities).toEqual(formatted.entities)
    expect(capturedOptions.reply_markup).toBeInstanceOf(InlineKeyboard)

    const replyMarkup = capturedOptions.reply_markup
    expect(replyMarkup).toBeDefined()
    assert(replyMarkup !== undefined)
    const inlineKeyboard = replyMarkup.inline_keyboard

    expect(inlineKeyboard.flat()).toEqual([
      { text: 'First', callback_data: 'first' },
      { text: 'Second', callback_data: 'second' },
      { text: 'Third', callback_data: 'third' },
    ])
  })

  test('sendReplacementTextReply edits the callback message and clears any existing keyboard', async () => {
    let capturedText: string | undefined
    let capturedOptions: ReplacementCallOptions | undefined
    const editMessageText = mock((text: string, ...rest: [] | [ReplacementCallOptions]) => {
      const options = rest[0]
      capturedText = text
      capturedOptions = options
      return Promise.resolve(true)
    })
    const ctx: ReplacementReplyContext = { editMessageText }

    await sendReplacementTextReply(ctx, '**Updated**')

    const formatted = formatLlmOutput('**Updated**')

    expect(editMessageText).toHaveBeenCalledTimes(1)

    expect(capturedText).toBe(formatted.text)
    expect(capturedOptions).toBeDefined()
    assert(capturedOptions !== undefined)
    expect(capturedOptions.entities).toEqual(formatted.entities)
    expect(capturedOptions.reply_markup).toBeInstanceOf(InlineKeyboard)
    const replyMarkup = capturedOptions.reply_markup
    expect(replyMarkup).toBeDefined()
    assert(replyMarkup !== undefined)
    expect(replyMarkup.inline_keyboard).toEqual([])
  })
})

describe('sendFormattedReply chunked delivery', () => {
  beforeEach(() => {
    mockLogger()
  })

  type CapturedSend = { text: string; opts: Record<string, unknown> | undefined }

  const okSend = (index: number): Promise<SentButtonMessage> =>
    Promise.resolve({ message_id: 100 + index, chat: { id: 7 } })

  /** Reply ctx whose nth reply resolves/rejects with `behaviors[n]` (defaulting to a success). */
  const makeChunkReplyCtx = (
    chatId: number | undefined,
    behaviors: ReadonlyArray<Promise<SentButtonMessage>>,
  ): { ctx: ButtonReplyCapableContext; calls: CapturedSend[] } => {
    const calls: CapturedSend[] = []
    const ctx: ButtonReplyCapableContext = {
      ...(chatId === undefined ? {} : { chat: { id: chatId } }),
      reply: (text: string, opts?: Record<string, unknown>): Promise<SentButtonMessage> => {
        const index = calls.length
        calls.push({ text, opts })
        return behaviors[index] ?? okSend(index)
      },
    }
    return { ctx, calls }
  }

  test('over-limit markdown is delivered as ordered chunks within the limit, split on paragraph boundaries', async () => {
    const paragraphs = ['para-0', 'para-1', 'para-2', 'para-3', 'para-4'].map((p) => `${p} ${'x'.repeat(1200)}`)
    const markdown = paragraphs.join('\n\n')
    const { ctx, calls } = makeChunkReplyCtx(7, [])

    const sent = await sendFormattedReply(ctx, markdown, () => ({ message_id: 5 }), undefined)

    expect(calls.length).toBe(2)
    for (const call of calls) {
      expect(call.text.length).toBeLessThanOrEqual(4096)
      expect(Array.isArray(call.opts?.['entities'])).toBe(true)
    }
    expect(calls[0]?.text.startsWith('para-0')).toBe(true)
    expect(calls[0]?.text.includes('para-2')).toBe(true)
    expect(calls[0]?.text.includes('para-3')).toBe(false)
    expect(calls[1]?.text.startsWith('para-3')).toBe(true)
    expect(calls[1]?.text.includes('para-4')).toBe(true)
    expect(calls.map((call) => call.opts?.['reply_parameters'])).toEqual([{ message_id: 5 }, { message_id: 5 }])
    expect(sent).toEqual({ messageId: 100, chatId: 7 })
  })

  test('over-limit markdown without paragraph breaks is split on line boundaries', async () => {
    const lines = ['line-0', 'line-1', 'line-2', 'line-3'].map((l) => `${l} ${'y'.repeat(1494)}`)
    const markdown = lines.join('\n')
    const { ctx, calls } = makeChunkReplyCtx(7, [])

    await sendFormattedReply(ctx, markdown, () => ({ message_id: 5 }), undefined)

    expect(calls.length).toBe(2)
    for (const call of calls) {
      expect(call.text.length).toBeLessThanOrEqual(4096)
    }
    expect(calls[0]?.text.startsWith('line-0')).toBe(true)
    expect(calls[0]?.text.includes('line-1')).toBe(true)
    expect(calls[0]?.text.includes('line-2')).toBe(false)
    expect(calls[1]?.text.startsWith('line-2')).toBe(true)
    expect(calls[1]?.text.includes('line-3')).toBe(true)
  })

  test('unbroken over-limit text is hard-cut at the limit', async () => {
    const { ctx, calls } = makeChunkReplyCtx(7, [])

    await sendFormattedReply(ctx, 'x'.repeat(8300), () => ({ message_id: 5 }), undefined)

    expect(calls.map((call) => call.text.length)).toEqual([4096, 4096, 108])
  })

  test('markdown whose formatted text fits the limit is delivered as a single message', async () => {
    const markdown = Array.from({ length: 900 }, () => '**b**').join('\n\n')
    const { ctx, calls } = makeChunkReplyCtx(7, [])

    await sendFormattedReply(ctx, markdown, () => ({ message_id: 5 }), undefined)

    expect(calls.length).toBe(1)
    expect(calls[0]?.text).toBe(Array.from({ length: 900 }, () => 'b').join('\n\n'))
    const entities = calls[0]?.opts?.['entities']
    expect(Array.isArray(entities)).toBe(true)
    assert(Array.isArray(entities))
    expect(entities.length).toBeGreaterThan(0)
  })

  // The chunked send loop lives in format-chunking.ts (reply-helpers.ts sits at the
  // max-lines cap), and its logger child binds at module-eval time, so the static
  // import above already captured the real logger. Rows that assert the per-chunk
  // warn install the tracked logger and force a fresh evaluation of the sibling with
  // a cache-busting query (mirrors tests/completion/verified-completion.test.ts);
  // formatted-length inflation is forced through the formatter DI param, not a
  // mock.module, so no module registry state leaks between rows.
  type ChunkSendModule = typeof import('../../../src/chat/telegram/format-chunking.js')

  const isChunkSendModule = (value: unknown): value is ChunkSendModule =>
    typeof value === 'object' && value !== null && typeof Reflect.get(value, 'sendFormattedTelegramChunks') === 'function'

  const loadChunkSend = async (tracked: TrackedLoggerMock): Promise<ChunkSendModule> => {
    void mock.module('../../../src/logger.js', () => ({
      getLogLevel: tracked.getLogLevel,
      logger: tracked.logger,
    }))
    const loaded: unknown = await import(
      `../../../src/chat/telegram/format-chunking.js?t=${crypto.randomUUID()}`
    )
    if (!isChunkSendModule(loaded)) {
      throw new Error('format-chunking module did not export the expected shape')
    }
    return loaded
  }

  test('a chunk whose formatted text exceeds the limit is re-split from its markdown at a reduced budget', async () => {
    const tracked = createTrackedLoggerMock()
    const { sendFormattedTelegramChunks: send } = await loadChunkSend(tracked)
    const doubling = (markdown: string): { text: string; entities: never[] } => ({
      text: markdown + markdown,
      entities: [],
    })
    const { ctx, calls } = makeChunkReplyCtx(7, [])

    await send(ctx, 'x'.repeat(6000), { message_id: 5 }, undefined, doubling)

    // 6000 md → [4096, 1904]; the 4096 piece doubles to 8192 > 4096 → re-split at
    // floor(4096·4096/8192) = 2048 → two pieces doubling to exactly 4096; the 1904
    // piece doubles to 3808 and fits.
    expect(calls.map((call) => call.text.length)).toEqual([4096, 4096, 3808])
  })

  test('a failed middle chunk warns with chat id and chunk position, still sends later chunks, and rethrows', async () => {
    const tracked = createTrackedLoggerMock()
    const { sendFormattedTelegramChunks: send } = await loadChunkSend(tracked)
    const paragraphs = ['fail-0', 'fail-1', 'fail-2', 'fail-3'].map((p) => `${p} ${'y'.repeat(2200)}`)
    const markdown = paragraphs.join('\n\n')
    const chunkError = new Error('telegram send failed')
    const { ctx, calls } = makeChunkReplyCtx(7, [okSend(0), Promise.reject(chunkError), okSend(2), okSend(3)])

    const rejection = await send(ctx, markdown, { message_id: 5 }, undefined).then(
      () => undefined,
      (err: unknown) => err,
    )

    expect(calls.length).toBe(4)
    expect(rejection).toBe(chunkError)
    const warn = tracked
      .getCallsByLevel('warn')
      .find((call) => call.args[1] === 'Failed to send Telegram reply chunk')
    expect(warn).toBeDefined()
    assert(warn !== undefined)
    expect(warn.args[0]).toMatchObject({ chatId: 7, chunkIndex: 1, chunkCount: 4 })
  })

  test('the first chunk error is the one rethrown when several chunks fail', async () => {
    const tracked = createTrackedLoggerMock()
    const { sendFormattedTelegramChunks: send } = await loadChunkSend(tracked)
    const paragraphs = ['fail-0', 'fail-1', 'fail-2', 'fail-3'].map((p) => `${p} ${'y'.repeat(2200)}`)
    const markdown = paragraphs.join('\n\n')
    const firstError = new Error('first failure')
    const laterError = new Error('later failure')
    const { ctx, calls } = makeChunkReplyCtx(7, [
      okSend(0),
      Promise.reject(firstError),
      Promise.reject(laterError),
      okSend(3),
    ])

    const rejection = await send(ctx, markdown, { message_id: 5 }, undefined).then(
      () => undefined,
      (err: unknown) => err,
    )

    expect(calls.length).toBe(4)
    expect(rejection).toBe(firstError)
  })

  test('a failed first chunk still attempts the remaining chunks and rethrows', async () => {
    const tracked = createTrackedLoggerMock()
    const { sendFormattedTelegramChunks: send } = await loadChunkSend(tracked)
    const paragraphs = ['fail-0', 'fail-1', 'fail-2', 'fail-3'].map((p) => `${p} ${'y'.repeat(2200)}`)
    const markdown = paragraphs.join('\n\n')
    const chunkError = new Error('telegram send failed')
    const { ctx, calls } = makeChunkReplyCtx(undefined, [
      Promise.reject(chunkError),
      okSend(1),
      okSend(2),
      okSend(3),
    ])

    const rejection = await send(ctx, markdown, { message_id: 5 }, undefined).then(
      () => undefined,
      (err: unknown) => err,
    )

    expect(calls.length).toBe(4)
    expect(rejection).toBe(chunkError)
    const warn = tracked
      .getCallsByLevel('warn')
      .find((call) => call.args[1] === 'Failed to send Telegram reply chunk')
    expect(warn).toBeDefined()
    assert(warn !== undefined)
    expect(warn.args[0]).toMatchObject({ chunkIndex: 0, chunkCount: 4, chatId: undefined })
  })
})
