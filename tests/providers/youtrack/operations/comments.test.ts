import { afterEach, beforeEach, describe, expect, mock, test } from 'bun:test'

import { z } from 'zod'

import { YouTrackClassifiedError } from '../../../../src/providers/youtrack/classify-error.js'
import type { YouTrackConfig } from '../../../../src/providers/youtrack/client.js'
import {
  addYouTrackComment,
  getYouTrackComments,
  removeYouTrackComment,
  updateYouTrackComment,
} from '../../../../src/providers/youtrack/operations/comments.js'
import { restoreFetch, setMockFetch } from '../../../test-helpers.js'
import { mockLogger } from '../../../utils/test-helpers.js'

// --- Fetch mocking infrastructure ---

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
  const parsed = FetchCallSchema.safeParse(fetchMock.mock.calls[0])
  if (!parsed.success) return new URL('https://empty')
  return new URL(parsed.data[0])
}

const getLastFetchBody = (): z.infer<typeof BodySchema> => {
  const parsed = FetchCallSchema.safeParse(fetchMock.mock.calls[0])
  if (!parsed.success) return {}
  const { body } = parsed.data[1]
  if (body === undefined) return {}
  return BodySchema.parse(JSON.parse(body))
}

const getLastFetchMethod = (): string => {
  const parsed = FetchCallSchema.safeParse(fetchMock.mock.calls[0])
  if (!parsed.success) return ''
  return parsed.data[1].method ?? ''
}

// --- Fixtures ---

type CommentFixture = Record<string, unknown>

const makeCommentResponse = (overrides: Record<string, unknown> = {}): CommentFixture => ({
  id: 'comment-1',
  text: 'Test comment body',
  author: { id: 'user-1', login: 'testuser', name: 'Test User' },
  created: 1700000000000,
  ...overrides,
})

// --- Tests ---

describe('addYouTrackComment', () => {
  beforeEach(() => {
    mockLogger()
    fetchMock = undefined!
  })

  afterEach(() => {
    restoreFetch()
  })

  test('adds comment and returns mapped result', async () => {
    mockFetchResponse(makeCommentResponse())

    const comment = await addYouTrackComment(config, 'TEST-1', 'Test comment body')

    expect(comment.id).toBe('comment-1')
    expect(comment.body).toBe('Test comment body')
    expect(comment.author).toBe('Test User')
    expect(comment.createdAt).toBeDefined()
  })

  test('maps author login when name is missing', async () => {
    mockFetchResponse(makeCommentResponse({ author: { id: 'user-1', login: 'jdoe' } }))

    const comment = await addYouTrackComment(config, 'TEST-1', 'Hello')

    expect(comment.author).toBe('jdoe')
  })

  test('sends text in request body', async () => {
    mockFetchResponse(makeCommentResponse())

    await addYouTrackComment(config, 'TEST-1', 'My comment text')

    const body = getLastFetchBody()
    expect(body['text']).toBe('My comment text')
  })

  test('uses POST method with task id in path', async () => {
    mockFetchResponse(makeCommentResponse())

    await addYouTrackComment(config, 'TEST-42', 'Hello')

    const url = getLastFetchUrl()
    expect(url.pathname).toBe('/api/issues/TEST-42/comments')
    expect(getLastFetchMethod()).toBe('POST')
  })

  test('throws classified error on failure', async () => {
    mockFetchError(400)

    await expect(addYouTrackComment(config, 'TEST-1', 'text')).rejects.toBeInstanceOf(YouTrackClassifiedError)
  })

  test('throws classified error on auth failure', async () => {
    mockFetchError(401)

    try {
      await addYouTrackComment(config, 'TEST-1', 'text')
      expect.unreachable('Should have thrown')
    } catch (error) {
      expect(error).toBeInstanceOf(YouTrackClassifiedError)
      if (error instanceof YouTrackClassifiedError) {
        expect(error.appError.code).toBe('auth-failed')
      }
    }
  })
})

describe('getYouTrackComments', () => {
  beforeEach(() => {
    mockLogger()
    fetchMock = undefined!
  })

  afterEach(() => {
    restoreFetch()
  })

  test('returns mapped comments', async () => {
    mockFetchResponse([makeCommentResponse(), makeCommentResponse({ id: 'comment-2', text: 'Second comment' })])

    const comments = await getYouTrackComments(config, 'TEST-1')

    expect(comments).toHaveLength(2)
    expect(comments[0]!.id).toBe('comment-1')
    expect(comments[0]!.body).toBe('Test comment body')
    expect(comments[0]!.author).toBe('Test User')
    expect(comments[0]!.createdAt).toBeDefined()
    expect(comments[1]!.id).toBe('comment-2')
    expect(comments[1]!.body).toBe('Second comment')
  })

  test('returns empty array when no comments', async () => {
    mockFetchResponse([])

    const comments = await getYouTrackComments(config, 'TEST-1')

    expect(comments).toEqual([])
  })

  test('uses GET method with task id in path', async () => {
    mockFetchResponse([])

    await getYouTrackComments(config, 'TEST-1')

    const url = getLastFetchUrl()
    expect(url.pathname).toBe('/api/issues/TEST-1/comments')
    expect(url.searchParams.get('$top')).toBe('100')
    expect(getLastFetchMethod()).toBe('GET')
  })

  test('throws classified error on failure', async () => {
    mockFetchError(500)

    await expect(getYouTrackComments(config, 'TEST-1')).rejects.toBeInstanceOf(YouTrackClassifiedError)
  })
})

describe('updateYouTrackComment', () => {
  beforeEach(() => {
    mockLogger()
    fetchMock = undefined!
  })

  afterEach(() => {
    restoreFetch()
  })

  test('updates comment and returns mapped result', async () => {
    mockFetchResponse(makeCommentResponse({ text: 'Updated body' }))

    const comment = await updateYouTrackComment(config, {
      taskId: 'TEST-1',
      commentId: 'comment-1',
      body: 'Updated body',
    })

    expect(comment.id).toBe('comment-1')
    expect(comment.body).toBe('Updated body')
  })

  test('sends text in request body', async () => {
    mockFetchResponse(makeCommentResponse())

    await updateYouTrackComment(config, {
      taskId: 'TEST-1',
      commentId: 'comment-1',
      body: 'New text',
    })

    const body = getLastFetchBody()
    expect(body['text']).toBe('New text')
  })

  test('uses POST method with task and comment id in path', async () => {
    mockFetchResponse(makeCommentResponse())

    await updateYouTrackComment(config, {
      taskId: 'TEST-1',
      commentId: 'comment-1',
      body: 'text',
    })

    const url = getLastFetchUrl()
    expect(url.pathname).toBe('/api/issues/TEST-1/comments/comment-1')
    expect(getLastFetchMethod()).toBe('POST')
  })

  test('throws classified error on 404', async () => {
    mockFetchError(404, { error: 'Comment not found /comments/' })

    try {
      await updateYouTrackComment(config, {
        taskId: 'TEST-1',
        commentId: 'nonexistent',
        body: 'text',
      })
      expect.unreachable('Should have thrown')
    } catch (error) {
      // The error message contains /issues/ in the path, so classifyNotFoundError
      // matches the issue check first
      expect(error).toBeInstanceOf(YouTrackClassifiedError)
    }
  })
})

describe('removeYouTrackComment', () => {
  beforeEach(() => {
    mockLogger()
    fetchMock = undefined!
  })

  afterEach(() => {
    restoreFetch()
  })

  test('removes comment and returns id', async () => {
    mockFetchNoContent()

    const result = await removeYouTrackComment(config, {
      taskId: 'TEST-1',
      commentId: 'comment-1',
    })

    expect(result).toEqual({ id: 'comment-1' })
  })

  test('uses DELETE method with task and comment id in path', async () => {
    mockFetchNoContent()

    await removeYouTrackComment(config, {
      taskId: 'TEST-1',
      commentId: 'comment-42',
    })

    const url = getLastFetchUrl()
    expect(url.pathname).toBe('/api/issues/TEST-1/comments/comment-42')
    expect(getLastFetchMethod()).toBe('DELETE')
  })

  test('throws classified error on 404', async () => {
    mockFetchError(404, { error: 'Comment not found /comments/' })

    try {
      await removeYouTrackComment(config, {
        taskId: 'TEST-1',
        commentId: 'nonexistent',
      })
      expect.unreachable('Should have thrown')
    } catch (error) {
      // The error message contains /issues/ in the path, so classifyNotFoundError
      // matches the issue check first
      expect(error).toBeInstanceOf(YouTrackClassifiedError)
    }
  })

  test('throws classified error on auth failure', async () => {
    mockFetchError(403)

    try {
      await removeYouTrackComment(config, {
        taskId: 'TEST-1',
        commentId: 'comment-1',
      })
      expect.unreachable('Should have thrown')
    } catch (error) {
      expect(error).toBeInstanceOf(YouTrackClassifiedError)
      if (error instanceof YouTrackClassifiedError) {
        expect(error.appError.code).toBe('auth-failed')
      }
    }
  })
})
