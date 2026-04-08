import { afterEach, beforeEach, describe, expect, mock, test } from 'bun:test'

import { z } from 'zod'

import type { SetTaskVisibilityParams } from '../../../../src/providers/types.js'
import { YouTrackClassifiedError } from '../../../../src/providers/youtrack/classify-error.js'
import type { YouTrackConfig } from '../../../../src/providers/youtrack/client.js'
import {
  addYouTrackCommentReaction,
  addYouTrackVote,
  addYouTrackWatcher,
  listYouTrackWatchers,
  removeYouTrackCommentReaction,
  removeYouTrackVote,
  removeYouTrackWatcher,
  setYouTrackVisibility,
} from '../../../../src/providers/youtrack/operations/collaboration.js'
import { mockLogger, restoreFetch, setMockFetch } from '../../../utils/test-helpers.js'

let fetchMock: ReturnType<typeof mock<(url: string, init: RequestInit) => Promise<Response>>>

const config: YouTrackConfig = {
  baseUrl: 'https://test.youtrack.cloud',
  token: 'test-token',
}

const installFetchMock = (handler: () => Promise<Response>): void => {
  const m = mock<(url: string, init: RequestInit) => Promise<Response>>(handler)
  fetchMock = m
  setMockFetch((url: string, init: RequestInit) => m(url, init))
}

const mockFetchResponse = (data: unknown, status = 200): void => {
  installFetchMock(() =>
    Promise.resolve(new Response(JSON.stringify(data), { status, headers: { 'Content-Type': 'application/json' } })),
  )
}

const mockFetchNoContent = (): void => {
  installFetchMock(() => Promise.resolve(new Response(null, { status: 204 })))
}

const mockFetchError = (status: number, body: unknown = { error: 'Something went wrong' }): void => {
  installFetchMock(() =>
    Promise.resolve(new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } })),
  )
}

const FetchCallSchema = z.tuple([
  z.string(),
  z.looseObject({ method: z.string().optional(), body: z.string().optional() }),
])

const BodySchema = z.looseObject({})

const getLastFetchUrl = (): URL => {
  const parsed = FetchCallSchema.safeParse(fetchMock.mock.calls.at(-1))
  if (!parsed.success) return new URL('https://empty')
  return new URL(parsed.data[0])
}

const getLastFetchBody = (): z.infer<typeof BodySchema> => {
  const parsed = FetchCallSchema.safeParse(fetchMock.mock.calls.at(-1))
  if (!parsed.success) return {}
  const { body } = parsed.data[1]
  if (body === undefined) return {}
  return BodySchema.parse(JSON.parse(body))
}

const getLastFetchMethod = (): string => {
  const parsed = FetchCallSchema.safeParse(fetchMock.mock.calls.at(-1))
  if (!parsed.success) return ''
  return parsed.data[1].method ?? ''
}

beforeEach(() => {
  mockLogger()
  fetchMock = undefined!
})

afterEach(() => {
  restoreFetch()
})

describe('listYouTrackWatchers', () => {
  test('returns normalized watchers from issue watchers', async () => {
    mockFetchResponse({
      id: 'issue-1',
      watchers: {
        hasStar: true,
        issueWatchers: [
          {
            isStarred: true,
            user: { id: 'user-1', login: 'alice', fullName: 'Alice Example', email: 'alice@example.com' },
          },
          {
            isStarred: false,
            user: { id: 'user-2', login: 'bob', fullName: 'Bob Example', email: 'bob@example.com' },
          },
        ],
      },
    })

    const watchers = await listYouTrackWatchers(config, 'TEST-1')

    expect(watchers).toEqual([
      { id: 'user-1', login: 'alice', name: 'Alice Example' },
      { id: 'user-2', login: 'bob', name: 'Bob Example' },
    ])
    expect(getLastFetchUrl().pathname).toBe('/api/issues/TEST-1')
    expect(getLastFetchMethod()).toBe('GET')
  })
})

describe('addYouTrackWatcher', () => {
  test('adds watcher by user id', async () => {
    mockFetchNoContent()

    const result = await addYouTrackWatcher(config, 'TEST-1', 'user-1')

    expect(result).toEqual({ taskId: 'TEST-1', userId: 'user-1' })
    expect(getLastFetchUrl().pathname).toBe('/api/issues/TEST-1/watchers/issueWatchers')
    expect(getLastFetchMethod()).toBe('POST')
    expect(getLastFetchBody()).toEqual({ user: { id: 'user-1' }, isStarred: true })
  })
})

describe('removeYouTrackWatcher', () => {
  test('removes watcher by user id', async () => {
    mockFetchNoContent()

    const result = await removeYouTrackWatcher(config, 'TEST-1', 'user-1')

    expect(result).toEqual({ taskId: 'TEST-1', userId: 'user-1' })
    expect(getLastFetchUrl().pathname).toBe('/api/issues/TEST-1/watchers/issueWatchers/user-1')
    expect(getLastFetchMethod()).toBe('DELETE')
  })
})

describe('addYouTrackVote', () => {
  test('issues vote command for task id', async () => {
    mockFetchNoContent()

    const result = await addYouTrackVote(config, 'TEST-1')

    expect(result).toEqual({ taskId: 'TEST-1' })
    expect(getLastFetchUrl().pathname).toBe('/api/commands')
    expect(getLastFetchUrl().search).toBe('')
    expect(getLastFetchMethod()).toBe('POST')
    expect(getLastFetchBody()).toEqual({ query: 'vote', issues: [{ idReadable: 'TEST-1' }] })
  })
})

describe('removeYouTrackVote', () => {
  test('issues unvote command for task id', async () => {
    mockFetchNoContent()

    const result = await removeYouTrackVote(config, 'TEST-1')

    expect(result).toEqual({ taskId: 'TEST-1' })
    expect(getLastFetchUrl().search).toBe('')
    expect(getLastFetchMethod()).toBe('POST')
    expect(getLastFetchBody()).toEqual({ query: 'unvote', issues: [{ idReadable: 'TEST-1' }] })
  })
})

describe('setYouTrackVisibility', () => {
  test('sets restricted visibility and normalizes response', async () => {
    mockFetchResponse({
      id: 'issue-1',
      visibility: {
        $type: 'LimitedVisibility',
        permittedUsers: [{ id: 'user-1', login: 'alice', fullName: 'Alice Example' }],
        permittedGroups: [{ id: 'group-1', name: 'Team Alpha' }],
      },
    })

    const result = await setYouTrackVisibility(config, 'TEST-1', {
      kind: 'restricted',
      userIds: ['user-1'],
      groupIds: ['group-1'],
    })

    expect(result).toEqual({
      taskId: 'TEST-1',
      visibility: {
        kind: 'restricted',
        users: [{ id: 'user-1', login: 'alice', name: 'Alice Example' }],
        groups: [{ id: 'group-1', name: 'Team Alpha' }],
      },
    })
    expect(getLastFetchUrl().pathname).toBe('/api/issues/TEST-1')
    expect(getLastFetchMethod()).toBe('POST')
    expect(getLastFetchBody()).toEqual({
      visibility: {
        $type: 'LimitedVisibility',
        permittedUsers: [{ id: 'user-1' }],
        permittedGroups: [{ id: 'group-1' }],
      },
    })
  })

  test('sets public visibility with unlimited payload', async () => {
    mockFetchResponse({
      id: 'issue-1',
      visibility: { $type: 'UnlimitedVisibility' },
    })

    const result = await setYouTrackVisibility(config, 'TEST-1', { kind: 'public' })

    expect(result).toEqual({
      taskId: 'TEST-1',
      visibility: { kind: 'public' },
    })
    expect(getLastFetchBody()).toEqual({
      visibility: { $type: 'UnlimitedVisibility' },
    })
  })

  test('rejects restricted visibility without any audience targets before making an API call', async () => {
    const invalidParams: SetTaskVisibilityParams = { kind: 'restricted', userIds: ['user-1'] }
    invalidParams.userIds.pop()

    await expect(setYouTrackVisibility(config, 'TEST-1', invalidParams)).rejects.toBeInstanceOf(YouTrackClassifiedError)
    expect(fetchMock).toBeUndefined()
  })
})

describe('addYouTrackCommentReaction', () => {
  test('adds a comment reaction and preserves reaction id', async () => {
    mockFetchResponse({
      id: 'reaction-1',
      reaction: 'thumbs_up',
      author: { id: 'user-1', login: 'alice', fullName: 'Alice Example', email: 'alice@example.com' },
    })

    const result = await addYouTrackCommentReaction(config, 'TEST-1', 'comment-1', 'thumbs_up')

    expect(result).toEqual({
      id: 'reaction-1',
      reaction: 'thumbs_up',
      author: { id: 'user-1', login: 'alice', name: 'Alice Example' },
      createdAt: undefined,
    })
    expect(getLastFetchUrl().pathname).toBe('/api/issues/TEST-1/comments/comment-1/reactions')
    expect(getLastFetchMethod()).toBe('POST')
    expect(getLastFetchBody()).toEqual({ reaction: 'thumbs_up' })
  })
})

describe('removeYouTrackCommentReaction', () => {
  test('removes a comment reaction by id', async () => {
    mockFetchNoContent()

    const result = await removeYouTrackCommentReaction(config, 'TEST-1', 'comment-1', 'reaction-1')

    expect(result).toEqual({ id: 'reaction-1', taskId: 'TEST-1', commentId: 'comment-1' })
    expect(getLastFetchUrl().pathname).toBe('/api/issues/TEST-1/comments/comment-1/reactions/reaction-1')
    expect(getLastFetchMethod()).toBe('DELETE')
  })

  test('classifies API failures', async () => {
    mockFetchError(404, { error: 'Comment not found /comments/' })

    await expect(removeYouTrackCommentReaction(config, 'TEST-1', 'comment-1', 'reaction-1')).rejects.toBeInstanceOf(
      YouTrackClassifiedError,
    )
  })
})
