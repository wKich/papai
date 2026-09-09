// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

import { beforeEach, describe, expect, mock, test } from 'bun:test'
import assert from 'node:assert/strict'

import { createMattermostReplyFn, sendMattermostDeferredMessage } from '../../../src/chat/mattermost/reply-helpers.js'
import type { DeferredDeliveryTarget, ReplyFn } from '../../../src/chat/types.js'
import { createTrackedLoggerMock, mockLogger, type TrackedLoggerMock } from '../../utils/test-helpers.js'

interface ReplyFnResult {
  reply: ReplyFn
  posts: unknown[]
  apiCalls: Array<{ method: string; path: string; body: unknown }>
}

describe('createMattermostReplyFn', () => {
  beforeEach(() => {
    mockLogger()
  })

  function makeReplyFn(callbackBaseUrl: string | null = 'https://bot.example', threadId?: string): ReplyFnResult {
    const posts: unknown[] = []
    const apiCalls: Array<{ method: string; path: string; body: unknown }> = []
    const apiFetch = (method: string, path: string, body: unknown): Promise<Record<string, string>> => {
      apiCalls.push({ method, path, body })
      if (method === 'POST' && path === '/api/v4/posts') {
        posts.push(body)
      }
      return Promise.resolve({ id: 'post-1' })
    }
    const wsSend = (): void => {}
    const uploadFile = (): Promise<string> => Promise.resolve('file-1')

    const reply = createMattermostReplyFn({
      channelId: 'chan-1',
      postId: 'post-1',
      threadId,
      getWsSeq: () => 1,
      apiFetch,
      wsSend,
      uploadFile,
      platformInstanceId: 'mattermost-main',
      callbackBaseUrl,
      createActionContext: (input) => {
        const threadPatch = input.threadId === undefined ? {} : { threadId: input.threadId }
        return {
          version: 1,
          platformInstanceId: input.platformInstanceId,
          channelId: input.channelId,
          callbackData: input.callbackData,
          sourceMessageText: input.sourceMessageText,
          expiresAt: input.expiresAt,
          nonce: 'nonce-nonce-nonce',
          signature: 'signature-signature-signature-signature-signature',
          ...threadPatch,
        }
      },
    })

    return { reply, posts, apiCalls }
  }

  describe('buttons', () => {
    test('posts Mattermost attachment actions', async () => {
      const { reply, posts } = makeReplyFn()

      await reply.buttons('choose', {
        buttons: [
          { text: 'Allow', callbackData: 'perm:a:abc12345', style: 'primary' },
          { text: 'Deny', callbackData: 'perm:d:abc12345' },
        ],
      })

      expect(posts).toHaveLength(1)
      expect(posts[0]).toMatchObject({
        channel_id: 'chan-1',
        message: 'choose',
        root_id: '',
        props: {
          attachments: [
            {
              actions: [
                {
                  id: 'action0',
                  type: 'button',
                  name: 'Allow',
                  style: 'primary',
                  integration: {
                    url: 'https://bot.example/mattermost/actions',
                    context: { channelId: 'chan-1', callbackData: 'perm:a:abc12345', sourceMessageText: 'choose' },
                  },
                },
                {
                  id: 'action1',
                  type: 'button',
                  name: 'Deny',
                  style: 'default',
                  integration: {
                    url: 'https://bot.example/mattermost/actions',
                    context: { channelId: 'chan-1', callbackData: 'perm:d:abc12345', sourceMessageText: 'choose' },
                  },
                },
              ],
            },
          ],
        },
      })
    })

    test('returns a handle whose remove() issues DELETE for the created post id', async () => {
      const { reply, apiCalls } = makeReplyFn()

      const handle = await reply.buttons('choose', {
        buttons: [{ text: 'Allow', callbackData: 'perm:a:abc12345', style: 'primary' }],
      })

      expect(handle).toBeDefined()
      await handle!.remove()

      const deleteCall = apiCalls.find((c) => c.method === 'DELETE')
      expect(deleteCall).toBeDefined()
      expect(deleteCall!.path).toBe('/api/v4/posts/post-1')
    })

    test('returns a handle whose redact() issues PUT patch with new text and clears props', async () => {
      const { reply, apiCalls } = makeReplyFn()

      const handle = await reply.buttons('choose', {
        buttons: [{ text: 'Allow', callbackData: 'perm:a:abc12345', style: 'primary' }],
      })

      expect(handle).toBeDefined()
      await handle!.redact('Prompt expired.')

      const putCall = apiCalls.find((c) => c.method === 'PUT')
      expect(putCall).toBeDefined()
      expect(putCall!.path).toBe('/api/v4/posts/post-1/patch')
      expect(putCall!.body).toMatchObject({ message: 'Prompt expired.', props: {} })
    })

    test('rejects when callback base URL is missing', async () => {
      const { reply } = makeReplyFn(null)

      await expect(
        reply.buttons('choose', {
          buttons: [{ text: 'Allow', callbackData: 'perm:a:abc12345' }],
        }),
      ).rejects.toThrow('Mattermost interactive buttons require SETTINGS_PUBLIC_BASE_URL')
    })

    test('includes the active thread id in action context', async () => {
      const { reply, posts } = makeReplyFn('https://bot.example', 'root-post-1')

      await reply.buttons('choose', {
        buttons: [{ text: 'Allow', callbackData: 'perm:a:abc12345' }],
      })

      expect(posts[0]).toMatchObject({
        root_id: 'root-post-1',
        props: {
          attachments: [
            {
              actions: [
                {
                  integration: {
                    context: { threadId: 'root-post-1' },
                  },
                },
              ],
            },
          ],
        },
      })
    })

    test('prefers an explicit reply thread id in action context', async () => {
      const { reply, posts } = makeReplyFn('https://bot.example', 'root-post-1')

      await reply.buttons('choose', {
        threadId: 'root-post-2',
        buttons: [{ text: 'Allow', callbackData: 'perm:a:abc12345' }],
      })

      expect(posts[0]).toMatchObject({
        root_id: 'root-post-2',
        props: {
          attachments: [
            {
              actions: [
                {
                  integration: {
                    context: { threadId: 'root-post-2' },
                  },
                },
              ],
            },
          ],
        },
      })
    })
  })

  describe('text', () => {
    test('posts message via apiFetch', async () => {
      const { reply, posts } = makeReplyFn()

      await reply.text('hello world')

      expect(posts).toHaveLength(1)
      expect(posts[0]).toMatchObject({
        channel_id: 'chan-1',
        message: 'hello world',
      })
    })
  })

  describe('formatted', () => {
    test('posts markdown via apiFetch', async () => {
      const { reply, posts } = makeReplyFn()

      await reply.formatted('**bold** text')

      expect(posts).toHaveLength(1)
      expect(posts[0]).toMatchObject({
        channel_id: 'chan-1',
        message: '**bold** text',
      })
    })
  })

  describe('formatted + editReply + lastReplyTarget', () => {
    test('formatted captures the post id via lastReplyTarget()', async () => {
      const { reply } = makeReplyFn()

      expect(reply.lastReplyTarget).toBeDefined()
      expect(reply.lastReplyTarget!()).toBeUndefined()

      await reply.formatted('**hello**')

      expect(reply.lastReplyTarget!()).toEqual({ platform: 'mattermost', ref: 'post-1' })
    })

    test('editReply PATCHes the captured post id with the new message', async () => {
      const { reply, apiCalls } = makeReplyFn()

      await reply.formatted('original')
      const target = reply.lastReplyTarget!()
      expect(target).toBeDefined()

      await reply.editReply!(target!, '**updated**')

      const patchCall = apiCalls.find((c) => c.method === 'PUT')
      expect(patchCall).toBeDefined()
      expect(patchCall!.path).toBe('/api/v4/posts/post-1/patch')
      expect(patchCall!.body).toEqual({ message: '**updated**' })
    })

    test('editReply leaves the message unformatted (posts markdown verbatim)', async () => {
      const { reply, apiCalls } = makeReplyFn()
      await reply.formatted('original')
      const target = reply.lastReplyTarget!()
      const markdown = '**bold** _italic_'
      await reply.editReply!(target!, markdown)
      const patchCall = apiCalls.find((c) => c.method === 'PUT')
      expect(patchCall!.body).toEqual({ message: markdown })
    })

    test('editReply swallows platform errors (never throws)', async () => {
      const calls: Array<{ method: string; path: string }> = []
      const reply = createMattermostReplyFn({
        channelId: 'chan-1',
        getWsSeq: () => 1,
        apiFetch: (method, path): Promise<unknown> => {
          calls.push({ method, path })
          return Promise.reject(new Error('patch failed'))
        },
        wsSend: () => {},
        uploadFile: () => Promise.resolve('file-1'),
        platformInstanceId: 'mattermost-main',
        callbackBaseUrl: 'https://bot.example',
        createActionContext: () => {
          throw new Error('not used')
        },
      })
      await reply.editReply!({ platform: 'mattermost', ref: 'post-9' }, 'new')
      expect(calls).toContainEqual({ method: 'PUT', path: '/api/v4/posts/post-9/patch' })
    })
  })

  describe('createStatus', () => {
    test('posts the status then updates and dismisses it', async () => {
      const { reply, apiCalls } = makeReplyFn()
      assert(reply.createStatus !== undefined, 'expected createStatus')

      const handle = await reply.createStatus('💭 Thinking…')
      assert(handle !== undefined, 'expected a status handle')
      await handle.update('📝 Creating task…')
      await handle.dismiss()

      const postCall = apiCalls.find((c) => c.method === 'POST')
      expect(postCall).toBeDefined()
      expect(postCall?.path).toBe('/api/v4/posts')
      expect(postCall?.body).toMatchObject({ message: '💭 Thinking…' })

      const patchCall = apiCalls.find((c) => c.method === 'PUT')
      expect(patchCall).toBeDefined()
      expect(patchCall?.path).toBe('/api/v4/posts/post-1/patch')
      expect(patchCall?.body).toMatchObject({ message: '📝 Creating task…' })

      const delCall = apiCalls.find((c) => c.method === 'DELETE')
      expect(delCall).toBeDefined()
      expect(delCall?.path).toBe('/api/v4/posts/post-1')
    })

    test('returns undefined (never rejects) when the post fails', async () => {
      const reply = createMattermostReplyFn({
        channelId: 'chan-1',
        getWsSeq: () => 1,
        apiFetch: (): Promise<unknown> => Promise.reject(new Error('mattermost down')),
        wsSend: () => {},
        uploadFile: () => Promise.resolve('file-1'),
        platformInstanceId: 'mattermost-main',
        callbackBaseUrl: 'https://bot.example',
        createActionContext: () => {
          throw new Error('not used in this test')
        },
      })
      assert(reply.createStatus !== undefined, 'expected createStatus')
      expect(await reply.createStatus('💭 Thinking…')).toBeUndefined()
    })
  })

  describe('formatted chunked delivery', () => {
    beforeEach(() => {
      mockLogger()
    })

    /** Reply fn whose POST /api/v4/posts calls record bodies and resolve with per-post ids (`post-<n>`). */
    const makeChunkReplyFn = (threadId?: string): { reply: ReplyFn; posts: unknown[] } => {
      const posts: unknown[] = []
      const apiFetch = (method: string, path: string, body: unknown): Promise<Record<string, string>> => {
        if (method === 'POST' && path === '/api/v4/posts') {
          posts.push(body)
          return Promise.resolve({ id: `post-${String(posts.length - 1)}` })
        }
        return Promise.resolve({ id: 'other' })
      }
      const reply = createMattermostReplyFn({
        channelId: 'chan-1',
        postId: 'post-1',
        threadId,
        getWsSeq: () => 1,
        apiFetch,
        wsSend: (): void => {},
        uploadFile: (): Promise<string> => Promise.resolve('file-1'),
        platformInstanceId: 'mattermost-main',
        callbackBaseUrl: 'https://bot.example',
        createActionContext: () => {
          throw new Error('not used')
        },
      })
      return { reply, posts }
    }

    const messageOf = (post: unknown): string => {
      assert(typeof post === 'object' && post !== null && 'message' in post)
      const { message } = post
      assert(typeof message === 'string')
      return message
    }

    test('over-limit markdown is delivered as ordered posts within the limit, split on paragraph boundaries', async () => {
      const paragraphs = ['para-0', 'para-1', 'para-2', 'para-3', 'para-4', 'para-5', 'para-6', 'para-7'].map(
        (label) => `${label} ${'x'.repeat(5000)}`,
      )
      const markdown = paragraphs.join('\n\n')
      const { reply, posts } = makeChunkReplyFn('root-9')

      await reply.formatted(markdown)

      expect(posts).toHaveLength(3)
      const messages = posts.map(messageOf)
      for (const message of messages) {
        expect(message.length).toBeLessThanOrEqual(16383)
        expect(message.startsWith('\n')).toBe(false)
      }
      for (const post of posts) {
        expect(post).toMatchObject({ channel_id: 'chan-1', root_id: 'root-9' })
      }
      expect(messages[0]?.startsWith('para-0')).toBe(true)
      expect(messages[0]?.includes('para-2')).toBe(true)
      expect(messages[0]?.includes('para-3')).toBe(false)
      expect(messages[1]?.startsWith('para-3')).toBe(true)
      expect(messages[2]?.startsWith('para-6')).toBe(true)
      expect(messages[2]?.includes('para-7')).toBe(true)
    })

    test('over-limit markdown without paragraph breaks is split on line boundaries', async () => {
      const lines = ['line-0', 'line-1', 'line-2', 'line-3'].map((label) => `${label} ${'y'.repeat(7000)}`)
      const markdown = lines.join('\n')
      const { reply, posts } = makeChunkReplyFn()

      await reply.formatted(markdown)

      expect(posts).toHaveLength(2)
      const messages = posts.map(messageOf)
      for (const message of messages) {
        expect(message.length).toBeLessThanOrEqual(16383)
      }
      expect(messages[0]?.startsWith('line-0')).toBe(true)
      expect(messages[0]?.includes('line-1')).toBe(true)
      expect(messages[0]?.includes('line-2')).toBe(false)
      expect(messages[1]?.startsWith('line-2')).toBe(true)
      expect(messages[1]?.includes('line-3')).toBe(true)
    })

    test('unbroken over-limit text is hard-cut at the limit', async () => {
      const { reply, posts } = makeChunkReplyFn()

      await reply.formatted('z'.repeat(40000))

      expect(posts.map(messageOf).map((message) => message.length)).toEqual([16383, 16383, 7234])
    })

    test('a hard cut that would split a surrogate pair is nudged left so astral characters stay whole', async () => {
      const { reply, posts } = makeChunkReplyFn()

      await reply.formatted('a'.repeat(4) + '😀'.repeat(10000))

      expect(posts.map(messageOf).map((message) => message.length)).toEqual([16382, 3622])
      expect(posts.map(messageOf)[1]?.startsWith('😀')).toBe(true)
    })

    test('within-limit markdown is delivered as a single verbatim post', async () => {
      const markdown = `**bold** ${'w'.repeat(16000)}`
      const { reply, posts } = makeChunkReplyFn()

      await reply.formatted(markdown)

      expect(posts).toHaveLength(1)
      expect(messageOf(posts[0])).toBe(markdown)
    })

    test('lastReplyTarget snapshots the first chunk post id, not the last', async () => {
      const markdown = `${'a'.repeat(10000)}\n\n${'b'.repeat(10000)}`
      const { reply } = makeChunkReplyFn()

      await reply.formatted(markdown)

      expect(reply.lastReplyTarget!()).toEqual({ platform: 'mattermost', ref: 'post-0' })
    })

    // The chunked send loop lives in format-chunking.ts (reply-helpers.ts sits near the
    // max-lines cap), and its logger child binds at module-eval time, so the static
    // import above already captured the real logger. Rows that assert the per-chunk
    // warn install the tracked logger and force a fresh evaluation of the sibling with
    // a cache-busting query (mirrors tests/chat/telegram/reply-helpers.test.ts).
    type MattermostChunkModule = typeof import('../../../src/chat/mattermost/format-chunking.js')

    const isMattermostChunkModule = (value: unknown): value is MattermostChunkModule =>
      typeof value === 'object' &&
      value !== null &&
      typeof Reflect.get(value, 'sendMattermostFormattedChunks') === 'function'

    const loadChunkSend = async (tracked: TrackedLoggerMock): Promise<MattermostChunkModule> => {
      void mock.module('../../../src/logger.js', () => ({
        getLogLevel: tracked.getLogLevel,
        logger: tracked.logger,
      }))
      const loaded: unknown = await import(`../../../src/chat/mattermost/format-chunking.js?t=${crypto.randomUUID()}`)
      if (!isMattermostChunkModule(loaded)) {
        throw new Error('format-chunking module did not export the expected shape')
      }
      return loaded
    }

    const failingParagraphs = ['fail-0', 'fail-1', 'fail-2', 'fail-3'].map((label) => `${label} ${'y'.repeat(9000)}`)

    const makeBehaviorPost = (
      behaviors: ReadonlyArray<Promise<string | undefined>>,
    ): { post: (message: string) => Promise<string | undefined>; sent: string[] } => {
      const sent: string[] = []
      const post = (message: string): Promise<string | undefined> => {
        const index = sent.length
        sent.push(message)
        return behaviors[index] ?? Promise.resolve(`post-${String(index)}`)
      }
      return { post, sent }
    }

    test('a failed middle chunk warns with channel id and chunk position, still sends later chunks, and rethrows', async () => {
      const tracked = createTrackedLoggerMock()
      const { sendMattermostFormattedChunks: send } = await loadChunkSend(tracked)
      const chunkError = new Error('mattermost send failed')
      const { post, sent } = makeBehaviorPost([
        Promise.resolve('post-0'),
        Promise.reject(chunkError),
        Promise.resolve('post-2'),
        Promise.resolve('post-3'),
      ])

      const rejection = await send('chan-1', post, failingParagraphs.join('\n\n'), undefined).then(
        () => undefined,
        (err: unknown) => err,
      )

      expect(sent).toHaveLength(4)
      expect(sent[0]?.startsWith('fail-0')).toBe(true)
      expect(sent[1]?.startsWith('fail-1')).toBe(true)
      expect(sent[2]?.startsWith('fail-2')).toBe(true)
      expect(sent[3]?.startsWith('fail-3')).toBe(true)
      expect(rejection).toBe(chunkError)
      const warn = tracked
        .getCallsByLevel('warn')
        .find((call) => call.args[1] === 'Failed to send Mattermost reply chunk')
      expect(warn).toBeDefined()
      assert(warn !== undefined)
      expect(warn.args[0]).toMatchObject({ channelId: 'chan-1', chunkIndex: 1, chunkCount: 4 })
    })

    test('the first chunk error is the one rethrown when several chunks fail', async () => {
      const tracked = createTrackedLoggerMock()
      const { sendMattermostFormattedChunks: send } = await loadChunkSend(tracked)
      const firstError = new Error('first failure')
      const laterError = new Error('later failure')
      const { post, sent } = makeBehaviorPost([
        Promise.resolve('post-0'),
        Promise.reject(firstError),
        Promise.reject(laterError),
        Promise.resolve('post-3'),
      ])

      const rejection = await send('chan-1', post, failingParagraphs.join('\n\n'), undefined).then(
        () => undefined,
        (err: unknown) => err,
      )

      expect(sent).toHaveLength(4)
      expect(rejection).toBe(firstError)
    })
  })
})

describe('sendMattermostDeferredMessage', () => {
  beforeEach(() => {
    mockLogger()
  })

  /** apiFetch double recording every post body; serves the DM-channel and mention-user lookups. */
  const makeDeferredApi = (): {
    apiFetch: (method: string, path: string, body: unknown) => Promise<unknown>
    posts: unknown[]
  } => {
    const posts: unknown[] = []
    const apiFetch = (method: string, path: string, body: unknown): Promise<unknown> => {
      if (method === 'POST' && path === '/api/v4/posts') {
        posts.push(body)
        return Promise.resolve({ id: `post-${String(posts.length - 1)}` })
      }
      if (method === 'POST' && path === '/api/v4/channels/direct') return Promise.resolve({ id: 'dm-chan' })
      if (method === 'GET' && path === '/api/v4/users/42') return Promise.resolve({ id: '42', username: 'alice' })
      return Promise.resolve({})
    }
    return { apiFetch, posts }
  }

  const messageOf = (post: unknown): string => {
    assert(typeof post === 'object' && post !== null && 'message' in post)
    const { message } = post
    assert(typeof message === 'string')
    return message
  }

  const groupPersonalTarget = (threadId: string | null): DeferredDeliveryTarget => ({
    contextId: 'chan-9',
    contextType: 'group',
    threadId,
    audience: 'personal',
    mentionUserIds: ['42'],
    createdByUserId: '42',
    createdByUsername: 'alice',
  })

  const dmTarget: DeferredDeliveryTarget = {
    contextId: '55',
    contextType: 'dm',
    threadId: null,
    audience: 'personal',
    mentionUserIds: [],
    createdByUserId: '55',
    createdByUsername: null,
  }

  test('deferred group-personal over-limit send arrives as ordered chunks, first prefixed, every chunk under the same root_id', async () => {
    const { apiFetch, posts } = makeDeferredApi()
    const paragraphs = ['chunk-0', 'chunk-1', 'chunk-2', 'chunk-3'].map((label) => `${label} ${'x'.repeat(9000)}`)

    await sendMattermostDeferredMessage('bot-1', groupPersonalTarget('root-5'), paragraphs.join('\n\n'), apiFetch)

    expect(posts).toHaveLength(4)
    const messages = posts.map(messageOf)
    for (const [index, post] of posts.entries()) {
      expect(messages[index]?.length).toBeLessThanOrEqual(16383)
      expect(post).toMatchObject({ channel_id: 'chan-9', root_id: 'root-5' })
    }
    expect(messages[0]?.startsWith('@alice chunk-0')).toBe(true)
    expect(messages[0]?.includes('chunk-1')).toBe(false)
    expect(messages[1]?.startsWith('chunk-1')).toBe(true)
    expect(messages[2]?.startsWith('chunk-2')).toBe(true)
    expect(messages[3]?.startsWith('chunk-3')).toBe(true)
  })

  test('counts the mention prefix length against the first chunk budget', async () => {
    const { apiFetch, posts } = makeDeferredApi()

    await sendMattermostDeferredMessage('bot-1', groupPersonalTarget('root-5'), 'x'.repeat(33000), apiFetch)

    expect(posts.map(messageOf).map((message) => message.length)).toEqual([16383, 16376, 248])
  })

  test('deferred dm over-limit send arrives as ordered unprefixed chunks in the direct channel', async () => {
    const { apiFetch, posts } = makeDeferredApi()
    const markdown = 'y'.repeat(40000)

    await sendMattermostDeferredMessage('bot-1', dmTarget, markdown, apiFetch)

    expect(posts.map(messageOf).map((message) => message.length)).toEqual([16383, 16383, 7234])
    for (const post of posts) {
      expect(post).toMatchObject({ channel_id: 'dm-chan' })
      expect(post).not.toHaveProperty('root_id')
    }
    expect(posts.map(messageOf).join('')).toBe(markdown)
  })

  // The deferred chunk send loop lives in format-chunking.ts (same max-lines
  // constraint as the immediate-path loop above), and its logger child binds at
  // module-eval time — same cache-busting pattern as loadChunkSend.
  type DeferredChunkModule = typeof import('../../../src/chat/mattermost/format-chunking.js')

  const isDeferredChunkModule = (value: unknown): value is DeferredChunkModule =>
    typeof value === 'object' &&
    value !== null &&
    typeof Reflect.get(value, 'sendMattermostDeferredChunks') === 'function'

  const loadDeferredChunkSend = async (tracked: TrackedLoggerMock): Promise<DeferredChunkModule> => {
    void mock.module('../../../src/logger.js', () => ({
      getLogLevel: tracked.getLogLevel,
      logger: tracked.logger,
    }))
    const loaded: unknown = await import(`../../../src/chat/mattermost/format-chunking.js?t=${crypto.randomUUID()}`)
    if (!isDeferredChunkModule(loaded)) {
      throw new Error('format-chunking module did not export the expected shape')
    }
    return loaded
  }

  // Same describe-scope double shape as makeBehaviorPost above: the ?? fallback
  // lives outside every test body, so the per-call behavior table stays a table.
  const makeDeferredBehaviorPost = (
    behaviors: ReadonlyArray<Promise<string>>,
  ): { post: (message: string) => Promise<string>; sent: string[] } => {
    const sent: string[] = []
    const post = (message: string): Promise<string> => {
      const index = sent.length
      sent.push(message)
      return behaviors[index] ?? Promise.resolve(`post-${String(index)}`)
    }
    return { post, sent }
  }

  test('a failed middle deferred chunk warns with channel id and chunk position, still sends later chunks, and rethrows', async () => {
    const tracked = createTrackedLoggerMock()
    const { sendMattermostDeferredChunks: send } = await loadDeferredChunkSend(tracked)
    const chunkError = new Error('mattermost deferred send failed')
    const { post, sent } = makeDeferredBehaviorPost([
      Promise.resolve('post-0'),
      Promise.reject(chunkError),
      Promise.resolve('post-2'),
      Promise.resolve('post-3'),
    ])
    const paragraphs = ['fail-0', 'fail-1', 'fail-2', 'fail-3'].map((label) => `${label} ${'z'.repeat(9000)}`)

    const rejection = await send('chan-1', post, paragraphs.join('\n\n'), '@alice ').then(
      () => undefined,
      (err: unknown) => err,
    )

    expect(sent).toHaveLength(4)
    expect(sent[0]?.startsWith('@alice fail-0')).toBe(true)
    expect(sent[1]?.startsWith('fail-1')).toBe(true)
    expect(sent[2]?.startsWith('fail-2')).toBe(true)
    expect(sent[3]?.startsWith('fail-3')).toBe(true)
    expect(rejection).toBe(chunkError)
    const warn = tracked
      .getCallsByLevel('warn')
      .find((call) => call.args[1] === 'Failed to send Mattermost deferred chunk')
    expect(warn).toBeDefined()
    assert(warn !== undefined)
    expect(warn.args[0]).toMatchObject({ channelId: 'chan-1', chunkIndex: 1, chunkCount: 4 })
  })
})
