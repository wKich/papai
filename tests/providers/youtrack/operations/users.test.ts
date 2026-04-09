import { afterEach, beforeEach, describe, expect, mock, test } from 'bun:test'

import { z } from 'zod'

import { YouTrackClassifiedError } from '../../../../src/providers/youtrack/classify-error.js'
import type { YouTrackConfig } from '../../../../src/providers/youtrack/client.js'
import {
  getYouTrackCurrentUser,
  listYouTrackUsers,
  resolveYouTrackUserRingId,
} from '../../../../src/providers/youtrack/operations/users.js'
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

const mockFetchSequence = (responses: Array<{ data: unknown; status?: number }>): void => {
  let callIndex = 0
  installFetchMock(() => {
    const response = responses[callIndex]
    callIndex++
    if (response === undefined) {
      return Promise.resolve(new Response(JSON.stringify([]), { status: 200 }))
    }
    return Promise.resolve(
      new Response(JSON.stringify(response.data), {
        status: response.status ?? 200,
        headers: { 'Content-Type': 'application/json' },
      }),
    )
  })
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

const getFetchUrlAt = (index: number): URL => {
  const parsed = FetchCallSchema.safeParse(fetchMock.mock.calls[index])
  if (!parsed.success) return new URL('https://empty')
  return new URL(parsed.data[0])
}

const getLastFetchMethod = (): string => {
  const parsed = FetchCallSchema.safeParse(fetchMock.mock.calls[fetchMock.mock.calls.length - 1])
  if (!parsed.success) return ''
  return parsed.data[1].method ?? ''
}

const makeUser = (overrides: Record<string, unknown> = {}): Record<string, unknown> => ({
  id: 'user-1',
  login: 'alice',
  name: 'Alice Example',
  fullName: 'Alice Example',
  email: 'alice@example.com',
  ringId: 'ring-user-1',
  $type: 'User',
  ...overrides,
})

describe('listYouTrackUsers', () => {
  beforeEach(() => {
    mockLogger()
    fetchMock = undefined!
  })

  afterEach(() => {
    restoreFetch()
  })

  test('filters users locally by login full name or email case-insensitively', async () => {
    mockFetchSequence([
      {
        data: [
          makeUser(),
          makeUser({ id: 'user-2', login: 'bob', fullName: 'Bob Example', email: 'alice.bob@example.com' }),
          makeUser({ id: 'user-3', login: 'charlie', fullName: 'Alice Johnson', email: 'charlie@example.com' }),
        ],
      },
    ])

    const users = await listYouTrackUsers(config, 'ALICE')

    expect(users).toEqual([
      { id: 'user-1', login: 'alice', name: 'Alice Example' },
      { id: 'user-2', login: 'bob', name: 'Bob Example' },
      { id: 'user-3', login: 'charlie', name: 'Alice Johnson' },
    ])
  })

  test('uses server-side query filter and limit for efficient user search', async () => {
    mockFetchSequence([{ data: [makeUser({ id: 'user-200', login: 'target', fullName: 'Target User' })] }])

    const users = await listYouTrackUsers(config, 'target', 1)

    expect(users).toEqual([{ id: 'user-200', login: 'target', name: 'Target User' }])
    expect(fetchMock.mock.calls).toHaveLength(1)

    const url = getFetchUrlAt(0)
    expect(url.pathname).toBe('/api/users')
    expect(url.searchParams.get('query')).toBe('nameStartsWith:target')
    expect(url.searchParams.get('$top')).toBe('1')
  })

  test('uses GET /api/users with expected fields', async () => {
    mockFetchSequence([{ data: [] }])

    await listYouTrackUsers(config)

    const url = getFetchUrlAt(0)
    expect(url.pathname).toBe('/api/users')
    expect(url.searchParams.get('fields')).toBe('id,login,fullName,name,email,ringId')
    expect(getLastFetchMethod()).toBe('GET')
  })

  test('throws classified error on API failure', async () => {
    mockFetchError(401)

    await expect(listYouTrackUsers(config, 'alice')).rejects.toBeInstanceOf(YouTrackClassifiedError)
  })
})

describe('getYouTrackCurrentUser', () => {
  beforeEach(() => {
    mockLogger()
    fetchMock = undefined!
  })

  afterEach(() => {
    restoreFetch()
  })

  test('returns the mapped current user and uses the me endpoint', async () => {
    mockFetchSequence([{ data: makeUser({ id: 'me-1', login: 'current', fullName: 'Current User' }) }])

    const user = await getYouTrackCurrentUser(config)

    expect(user).toEqual({ id: 'me-1', login: 'current', name: 'Current User' })

    const url = getFetchUrlAt(0)
    expect(url.pathname).toBe('/api/users/me')
    expect(url.searchParams.get('fields')).toBe('id,login,fullName,name,email,ringId')
    expect(getLastFetchMethod()).toBe('GET')
  })

  test('throws classified error on auth failure', async () => {
    mockFetchError(403)

    await expect(getYouTrackCurrentUser(config)).rejects.toBeInstanceOf(YouTrackClassifiedError)
  })
})

describe('resolveYouTrackUserRingId', () => {
  beforeEach(() => {
    mockLogger()
    fetchMock = undefined!
  })

  afterEach(() => {
    restoreFetch()
  })

  test('returns the Hub ringId for a direct user lookup', async () => {
    mockFetchSequence([{ data: makeUser({ id: 'user-7', ringId: 'ring-user-7', login: 'alice' }) }])

    const ringId = await resolveYouTrackUserRingId(config, 'user-7')

    expect(ringId).toBe('ring-user-7')
    const url = getFetchUrlAt(0)
    expect(url.pathname).toBe('/api/users/user-7')
    expect(url.searchParams.get('fields')).toBe('id,login,fullName,name,email,ringId')
    expect(getLastFetchMethod()).toBe('GET')
  })

  test('falls back to scanning the users collection when the identifier is already a ringId', async () => {
    mockFetchSequence([
      { data: { error: 'Not found' }, status: 404 },
      { data: [makeUser({ id: 'user-7', ringId: 'ring-user-7', login: 'alice' })] },
    ])

    const ringId = await resolveYouTrackUserRingId(config, 'ring-user-7')

    expect(ringId).toBe('ring-user-7')
    expect(fetchMock.mock.calls).toHaveLength(2)
    expect(getFetchUrlAt(0).pathname).toBe('/api/users/ring-user-7')
    expect(getFetchUrlAt(1).pathname).toBe('/api/users')
  })

  test('throws a classified error when the user cannot be resolved', async () => {
    mockFetchSequence([{ data: { error: 'Not found' }, status: 404 }, { data: [] }])

    await expect(resolveYouTrackUserRingId(config, 'missing-user')).rejects.toBeInstanceOf(YouTrackClassifiedError)
  })

  test('throws not-found error when user is not found in collection scan', async () => {
    mockFetchSequence([{ data: { error: 'Not found' }, status: 404 }, { data: [] }])

    const error = await resolveYouTrackUserRingId(config, 'missing-user').catch((e: unknown) => e)

    expect(error).toBeInstanceOf(YouTrackClassifiedError)
    const classifiedError = error instanceof YouTrackClassifiedError ? error : null
    if (classifiedError === null) {
      throw new Error('Expected YouTrackClassifiedError')
    }
    expect(classifiedError.appError).toEqual({
      type: 'provider',
      code: 'not-found',
      resourceType: 'User',
      resourceId: 'missing-user',
    })
  })
})
