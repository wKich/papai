// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

import { describe, expect, mock, test } from 'bun:test'
import assert from 'node:assert/strict'

import { createKonturTalkReplyFn } from '../../../src/chat/kontur-talk/reply-helpers.js'
import type { ReplyFn } from '../../../src/chat/types.js'
import { createTrackedLoggerMock, type TrackedLoggerMock } from '../../utils/test-helpers.js'

function makeReplyFn(): { reply: ReplyFn; posts: unknown[] } {
  const posts: unknown[] = []
  const apiFetch = (_method: string, _path: string, body: unknown): Promise<unknown> => {
    posts.push(body)
    return Promise.resolve({ event_id: '$newEvent' })
  }
  const reply = createKonturTalkReplyFn({
    roomId: '!room:host',
    threadId: undefined,
    apiFetch,
  })
  return { reply, posts }
}

describe('createKonturTalkReplyFn', () => {
  test('text() sends plain format message', async () => {
    const { reply, posts } = makeReplyFn()
    await reply.text('Hello')
    expect(posts).toEqual([{ room_id: '!room:host', message: 'Hello', format: 'plain', thread_id: null, mentions: [] }])
  })

  test('formatted() sends markdown format message', async () => {
    const { reply, posts } = makeReplyFn()
    await reply.formatted('**bold**')
    expect(posts).toEqual([
      { room_id: '!room:host', message: '**bold**', format: 'markdown', thread_id: null, mentions: [] },
    ])
  })

  test('text() passes thread_id when present', async () => {
    const posts: unknown[] = []
    const apiFetch = (_method: string, _path: string, body: unknown): Promise<unknown> => {
      posts.push(body)
      return Promise.resolve({ event_id: '$newEvent' })
    }
    const reply = createKonturTalkReplyFn({
      roomId: '!room:host',
      threadId: '$thread123',
      apiFetch,
    })
    await reply.text('In thread')
    expect(posts).toEqual([
      { room_id: '!room:host', message: 'In thread', format: 'plain', thread_id: '$thread123', mentions: [] },
    ])
  })

  test('text() uses option threadId over default', async () => {
    const posts: unknown[] = []
    const apiFetch = (_method: string, _path: string, body: unknown): Promise<unknown> => {
      posts.push(body)
      return Promise.resolve({ event_id: '$newEvent' })
    }
    const reply = createKonturTalkReplyFn({
      roomId: '!room:host',
      threadId: '$defaultThread',
      apiFetch,
    })
    await reply.text('Override', { threadId: '$otherThread' })
    expect(posts[0]).toEqual(expect.objectContaining({ thread_id: '$otherThread' }))
  })

  test('typing() is a no-op', () => {
    const { reply } = makeReplyFn()
    expect(() => reply.typing()).not.toThrow()
  })

  test('buttons() throws', async () => {
    const { reply } = makeReplyFn()
    await expect(reply.buttons('content', { buttons: [] })).rejects.toThrow(/does not support/iu)
  })

  test('does not provide createStatus (no edit/delete API)', () => {
    const { reply } = makeReplyFn()
    expect(reply.createStatus).toBeUndefined()
  })

  describe('formatted chunked delivery', () => {
    /** Reply fn whose /send_message calls record bodies; optional per-call behaviors. */
    const makeChunkReplyFn = (
      threadId?: string,
      behaviors?: ReadonlyArray<Promise<unknown>>,
    ): { reply: ReplyFn; posts: unknown[] } => {
      const posts: unknown[] = []
      const apiFetch = (_method: string, _path: string, body: unknown): Promise<unknown> => {
        const index = posts.length
        posts.push(body)
        return behaviors?.[index] ?? Promise.resolve({ event_id: `$e${String(index)}` })
      }
      const reply = createKonturTalkReplyFn({ roomId: '!room:host', threadId, apiFetch })
      return { reply, posts }
    }

    const messageOf = (post: unknown): string => {
      assert(typeof post === 'object' && post !== null && 'message' in post)
      const { message } = post
      assert(typeof message === 'string')
      return message
    }

    test('over-limit markdown is delivered as ordered sends within the limit, split on paragraph boundaries', async () => {
      const paragraphs = ['para-0', 'para-1', 'para-2', 'para-3', 'para-4', 'para-5'].map(
        (label) => `${label} ${'x'.repeat(1500)}`,
      )
      const markdown = paragraphs.join('\n\n')
      const { reply, posts } = makeChunkReplyFn('$thread123')

      await reply.formatted(markdown)

      expect(posts).toHaveLength(3)
      const messages = posts.map(messageOf)
      for (const message of messages) {
        expect(message.length).toBeLessThanOrEqual(4096)
        expect(message.startsWith('\n')).toBe(false)
      }
      for (const post of posts) {
        expect(post).toMatchObject({
          room_id: '!room:host',
          format: 'markdown',
          thread_id: '$thread123',
          mentions: [],
        })
      }
      expect(messages[0]?.startsWith('para-0')).toBe(true)
      expect(messages[0]?.includes('para-1')).toBe(true)
      expect(messages[0]?.includes('para-2')).toBe(false)
      expect(messages[1]?.startsWith('para-2')).toBe(true)
      expect(messages[1]?.includes('para-3')).toBe(true)
      expect(messages[2]?.startsWith('para-4')).toBe(true)
      expect(messages[2]?.includes('para-5')).toBe(true)
    })

    test('over-limit markdown without paragraph breaks is split on line boundaries', async () => {
      const lines = ['line-0', 'line-1', 'line-2'].map((label) => `${label} ${'y'.repeat(2400)}`)
      const { reply, posts } = makeChunkReplyFn()

      await reply.formatted(lines.join('\n'))

      expect(posts).toHaveLength(3)
      const messages = posts.map(messageOf)
      for (const message of messages) {
        expect(message.length).toBeLessThanOrEqual(4096)
      }
      expect(messages[0]?.startsWith('line-0')).toBe(true)
      expect(messages[0]?.includes('line-1')).toBe(false)
      expect(messages[1]?.startsWith('line-1')).toBe(true)
      expect(messages[1]?.includes('line-2')).toBe(false)
      expect(messages[2]?.startsWith('line-2')).toBe(true)
    })

    test('unbroken over-limit text is hard-cut at the limit', async () => {
      const { reply, posts } = makeChunkReplyFn()

      await reply.formatted('z'.repeat(10000))

      expect(posts.map(messageOf).map((message) => message.length)).toEqual([4096, 4096, 1808])
    })

    test('a hard cut that would split a surrogate pair is nudged left so astral characters stay whole', async () => {
      const { reply, posts } = makeChunkReplyFn()

      await reply.formatted('a'.repeat(3) + '😀'.repeat(10000))

      expect(posts.map(messageOf).map((message) => message.length)).toEqual([4095, 4096, 4096, 4096, 3620])
      expect(posts.map(messageOf)[1]?.startsWith('😀')).toBe(true)
    })

    test('within-limit markdown is delivered as a single verbatim send', async () => {
      const markdown = `**bold** ${'w'.repeat(4000)}`
      const { reply, posts } = makeChunkReplyFn()

      await reply.formatted(markdown)

      expect(posts).toHaveLength(1)
      expect(messageOf(posts[0])).toBe(markdown)
      expect(posts[0]).toMatchObject({ format: 'markdown' })
    })

    test('an over-limit plain text call stays one unchunked send', async () => {
      const { reply, posts } = makeChunkReplyFn()

      await reply.text('t'.repeat(5000))

      expect(posts).toHaveLength(1)
      expect(messageOf(posts[0]).length).toBe(5000)
      expect(posts[0]).toMatchObject({ format: 'plain' })
    })

    // The chunked send loop and its logger child live in reply-helpers.ts, binding the
    // logger at module-eval time, so the static import above already captured the real
    // logger. Rows that assert the per-chunk warn install the tracked logger and force
    // a fresh evaluation of the module with a cache-busting query (mirrors
    // tests/chat/mattermost/reply-helpers.test.ts).
    type KonturTalkReplyModule = typeof import('../../../src/chat/kontur-talk/reply-helpers.js')

    const isKonturTalkReplyModule = (value: unknown): value is KonturTalkReplyModule =>
      typeof value === 'object' && value !== null && typeof Reflect.get(value, 'createKonturTalkReplyFn') === 'function'

    const loadChunkedReplyModule = async (tracked: TrackedLoggerMock): Promise<KonturTalkReplyModule> => {
      void mock.module('../../../src/logger.js', () => ({
        getLogLevel: tracked.getLogLevel,
        logger: tracked.logger,
      }))
      const loaded: unknown = await import(`../../../src/chat/kontur-talk/reply-helpers.js?t=${crypto.randomUUID()}`)
      if (!isKonturTalkReplyModule(loaded)) {
        throw new Error('kontur-talk reply-helpers module did not export the expected shape')
      }
      return loaded
    }

    const makeBehaviorApiFetch = (
      posts: unknown[],
      behaviors: ReadonlyArray<Promise<unknown>>,
    ): ((method: string, path: string, body: unknown) => Promise<unknown>) => {
      return (_method, _path, body) => {
        const index = posts.length
        posts.push(body)
        return behaviors[index] ?? Promise.resolve({ event_id: `$e${String(index)}` })
      }
    }

    const failingParagraphs = ['fail-0', 'fail-1', 'fail-2', 'fail-3'].map((label) => `${label} ${'y'.repeat(2200)}`)

    test('a failed middle chunk warns with room id and chunk position, still sends later chunks, and rethrows', async () => {
      const tracked = createTrackedLoggerMock()
      const { createKonturTalkReplyFn: createFresh } = await loadChunkedReplyModule(tracked)
      const chunkError = new Error('kontur talk send failed')
      const posts: unknown[] = []
      const reply = createFresh({
        roomId: '!room:host',
        threadId: undefined,
        apiFetch: makeBehaviorApiFetch(posts, [
          Promise.resolve({ event_id: '$e0' }),
          Promise.reject(chunkError),
          Promise.resolve({ event_id: '$e2' }),
          Promise.resolve({ event_id: '$e3' }),
        ]),
      })

      const rejection = await reply.formatted(failingParagraphs.join('\n\n')).then(
        () => undefined,
        (err: unknown) => err,
      )

      expect(posts).toHaveLength(4)
      expect(posts.map(messageOf).map((message) => message.startsWith('fail-'))).toEqual([true, true, true, true])
      expect(rejection).toBe(chunkError)
      const warn = tracked
        .getCallsByLevel('warn')
        .find((call) => call.args[1] === 'Failed to send Kontur Talk reply chunk')
      expect(warn).toBeDefined()
      assert(warn !== undefined)
      expect(warn.args[0]).toMatchObject({ roomId: '!room:host', chunkIndex: 1, chunkCount: 4 })
    })

    test('the first chunk error is the one rethrown when several chunks fail', async () => {
      const tracked = createTrackedLoggerMock()
      const { createKonturTalkReplyFn: createFresh } = await loadChunkedReplyModule(tracked)
      const firstError = new Error('first failure')
      const laterError = new Error('later failure')
      const posts: unknown[] = []
      const reply = createFresh({
        roomId: '!room:host',
        threadId: undefined,
        apiFetch: makeBehaviorApiFetch(posts, [
          Promise.resolve({ event_id: '$e0' }),
          Promise.reject(firstError),
          Promise.reject(laterError),
          Promise.resolve({ event_id: '$e3' }),
        ]),
      })

      const rejection = await reply.formatted(failingParagraphs.join('\n\n')).then(
        () => undefined,
        (err: unknown) => err,
      )

      expect(posts).toHaveLength(4)
      expect(rejection).toBe(firstError)
    })
  })
})
