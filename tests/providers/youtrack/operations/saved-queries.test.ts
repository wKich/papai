import { afterEach, beforeEach, describe, expect, mock, test } from 'bun:test'

import { z } from 'zod'

import { YouTrackClassifiedError } from '../../../../src/providers/youtrack/classify-error.js'
import type { YouTrackConfig } from '../../../../src/providers/youtrack/client.js'
import {
  listYouTrackSavedQueries,
  runYouTrackSavedQuery,
} from '../../../../src/providers/youtrack/operations/saved-queries.js'
import { mockLogger, restoreFetch, setMockFetch } from '../../../utils/test-helpers.js'

let fetchMock: ReturnType<typeof mock<(url: string, init: RequestInit) => Promise<Response>>> | undefined

const config: YouTrackConfig = {
  baseUrl: 'https://test.youtrack.cloud',
  token: 'test-token',
}

const installFetchMock = (handler: () => Promise<Response>): void => {
  const mocked = mock<(url: string, init: RequestInit) => Promise<Response>>(handler)
  fetchMock = mocked
  setMockFetch((url: string, init: RequestInit) => mocked(url, init))
}

const createJsonResponse = (data: unknown, status = 200): Response =>
  new Response(JSON.stringify(data), { status, headers: { 'Content-Type': 'application/json' } })

const mockFetchResponse = (data: unknown, status = 200): void => {
  installFetchMock(() => Promise.resolve(createJsonResponse(data, status)))
}

const mockFetchSequence = (responses: Array<{ data: unknown; status?: number }>): void => {
  let callIndex = 0
  installFetchMock(() => {
    const response = responses[callIndex]
    callIndex++
    if (response === undefined) {
      return Promise.resolve(createJsonResponse({}, 200))
    }
    return Promise.resolve(createJsonResponse(response.data, response.status ?? 200))
  })
}

const mockFetchError = (status: number, body: unknown = { error: 'Something went wrong' }): void => {
  installFetchMock(() => Promise.resolve(createJsonResponse(body, status)))
}

const FetchCallSchema = z.tuple([
  z.string(),
  z.looseObject({ method: z.string().optional(), body: z.string().optional() }),
])

const getFetchUrlAt = (index: number): URL => {
  const parsed = FetchCallSchema.safeParse(fetchMock?.mock.calls[index])
  if (!parsed.success) return new URL('https://empty')
  return new URL(parsed.data[0])
}

const getFetchMethodAt = (index: number): string => {
  const parsed = FetchCallSchema.safeParse(fetchMock?.mock.calls[index])
  if (!parsed.success) return ''
  return parsed.data[1].method ?? ''
}

const makeIssueListResponse = (overrides: Record<string, unknown> = {}): Record<string, unknown> => ({
  id: '2-1',
  idReadable: 'TEST-1',
  summary: 'Bug fix',
  project: { id: '0-1', shortName: 'TEST' },
  customFields: [
    { $type: 'SingleEnumIssueCustomField', name: 'Priority', value: { name: 'High' } },
    { $type: 'StateIssueCustomField', name: 'State', value: { name: 'Open' } },
  ],
  ...overrides,
})

beforeEach(() => {
  mockLogger()
})

afterEach(() => {
  restoreFetch()
  fetchMock = undefined
})

describe('listYouTrackSavedQueries', () => {
  test('lists saved queries and maps response', async () => {
    mockFetchResponse([{ id: 'query-1', name: 'Open Issues', query: 'State: Open' }])

    const queries = await listYouTrackSavedQueries(config)

    expect(queries).toEqual([{ id: 'query-1', name: 'Open Issues', query: 'State: Open' }])
    expect(getFetchUrlAt(0).pathname).toBe('/api/savedQueries')
    expect(getFetchUrlAt(0).searchParams.get('fields')).toBe('id,name,query')
    expect(getFetchUrlAt(0).searchParams.get('$top')).toBe('100')
    expect(getFetchMethodAt(0)).toBe('GET')
  })

  test('throws classified error on failure', async () => {
    mockFetchError(403)

    await expect(listYouTrackSavedQueries(config)).rejects.toBeInstanceOf(YouTrackClassifiedError)
  })
})

describe('runYouTrackSavedQuery', () => {
  test('fetches query definition and executes issue search', async () => {
    mockFetchSequence([
      { data: { id: 'query-1', name: 'Open Issues', query: 'State: Open' } },
      { data: [makeIssueListResponse()] },
    ])

    const results = await runYouTrackSavedQuery(config, 'query-1')

    expect(results).toEqual([
      {
        id: 'TEST-1',
        title: 'Bug fix',
        status: 'Open',
        priority: 'High',
        projectId: '0-1',
        url: 'https://test.youtrack.cloud/issue/TEST-1',
      },
    ])
    expect(getFetchUrlAt(0).pathname).toBe('/api/savedQueries/query-1')
    expect(getFetchUrlAt(0).searchParams.get('fields')).toBe('id,name,query')
    expect(getFetchMethodAt(0)).toBe('GET')
    expect(getFetchUrlAt(1).pathname).toBe('/api/issues')
    expect(getFetchUrlAt(1).searchParams.get('fields')).toBe(
      'id,idReadable,numberInProject,summary,resolved,created,project(id,shortName),customFields($type,name,value($type,name,login))',
    )
    expect(getFetchUrlAt(1).searchParams.get('query')).toBe('State: Open')
    expect(getFetchUrlAt(1).searchParams.get('$top')).toBe('100')
    expect(getFetchUrlAt(1).searchParams.get('$skip')).toBe('0')
    expect(getFetchMethodAt(1)).toBe('GET')
  })
})
