import { afterEach, beforeEach, describe, expect, mock, test } from 'bun:test'

import { z } from 'zod'

import { YouTrackClassifiedError } from '../../../../src/providers/youtrack/classify-error.js'
import type { YouTrackConfig } from '../../../../src/providers/youtrack/client.js'
import {
  assignYouTrackTaskToSprint,
  createYouTrackSprint,
  listYouTrackAgiles,
  listYouTrackSprints,
  updateYouTrackSprint,
} from '../../../../src/providers/youtrack/operations/agiles.js'
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
    if (response.status === 204) {
      return Promise.resolve(new Response(null, { status: 204 }))
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

const BodySchema = z.looseObject({})

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

const getFetchBodyAt = (index: number): z.infer<typeof BodySchema> => {
  const parsed = FetchCallSchema.safeParse(fetchMock?.mock.calls[index])
  if (!parsed.success) return {}
  const { body } = parsed.data[1]
  if (body === undefined) return {}
  return BodySchema.parse(JSON.parse(body))
}

const makeSprintResponse = (overrides: Record<string, unknown> = {}): Record<string, unknown> => ({
  id: 'sprint-1',
  name: 'Sprint 1',
  archived: false,
  goal: 'Ship it',
  isDefault: true,
  start: 1700000000000,
  finish: 1700600000000,
  unresolvedIssuesCount: 7,
  ...overrides,
})

beforeEach(() => {
  mockLogger()
})

afterEach(() => {
  restoreFetch()
  fetchMock = undefined
})

describe('listYouTrackAgiles', () => {
  test('lists agiles and maps response', async () => {
    mockFetchResponse([{ id: 'agile-1', name: 'Team Board' }])

    const agiles = await listYouTrackAgiles(config)

    expect(agiles).toEqual([{ id: 'agile-1', name: 'Team Board' }])
    expect(getFetchUrlAt(0).pathname).toBe('/api/agiles')
    expect(getFetchUrlAt(0).searchParams.get('fields')).toBe('id,name')
    expect(getFetchUrlAt(0).searchParams.get('$top')).toBe('100')
    expect(getFetchMethodAt(0)).toBe('GET')
  })

  test('paginates beyond the first agile page', async () => {
    mockFetchSequence([
      {
        data: Array.from({ length: 100 }, (_, index) => ({ id: `agile-${index + 1}`, name: `Agile ${index + 1}` })),
      },
      {
        data: [{ id: 'agile-101', name: 'Agile 101' }],
      },
    ])

    const agiles = await listYouTrackAgiles(config)

    expect(agiles).toHaveLength(101)
    expect(agiles.at(100)).toEqual({ id: 'agile-101', name: 'Agile 101' })
    expect(getFetchUrlAt(0).searchParams.get('$skip')).toBe('0')
    expect(getFetchUrlAt(1).searchParams.get('$skip')).toBe('100')
  })

  test('throws classified error on failure', async () => {
    mockFetchError(401)

    await expect(listYouTrackAgiles(config)).rejects.toBeInstanceOf(YouTrackClassifiedError)
  })
})

describe('listYouTrackSprints', () => {
  test('lists sprints and maps timestamps to iso strings', async () => {
    mockFetchResponse([makeSprintResponse()])

    const sprints = await listYouTrackSprints(config, 'agile-1')

    expect(sprints).toEqual([
      {
        id: 'sprint-1',
        agileId: 'agile-1',
        name: 'Sprint 1',
        start: new Date(1700000000000).toISOString(),
        finish: new Date(1700600000000).toISOString(),
        archived: false,
        goal: 'Ship it',
        isDefault: true,
        unresolvedIssuesCount: 7,
      },
    ])
    expect(getFetchUrlAt(0).pathname).toBe('/api/agiles/agile-1/sprints')
    expect(getFetchUrlAt(0).searchParams.get('fields')).toBe(
      'id,name,archived,goal,isDefault,start,finish,unresolvedIssuesCount',
    )
    expect(getFetchUrlAt(0).searchParams.get('$top')).toBe('100')
    expect(getFetchMethodAt(0)).toBe('GET')
  })

  test('paginates beyond the first sprint page', async () => {
    mockFetchSequence([
      {
        data: Array.from({ length: 100 }, (_, index) =>
          makeSprintResponse({
            id: `sprint-${index + 1}`,
            name: `Sprint ${index + 1}`,
          }),
        ),
      },
      {
        data: [makeSprintResponse({ id: 'sprint-101', name: 'Sprint 101' })],
      },
    ])

    const sprints = await listYouTrackSprints(config, 'agile-1')

    expect(sprints).toHaveLength(101)
    expect(sprints.at(100)).toEqual({
      id: 'sprint-101',
      agileId: 'agile-1',
      name: 'Sprint 101',
      start: new Date(1700000000000).toISOString(),
      finish: new Date(1700600000000).toISOString(),
      archived: false,
      goal: 'Ship it',
      isDefault: true,
      unresolvedIssuesCount: 7,
    })
    expect(getFetchUrlAt(0).searchParams.get('$skip')).toBe('0')
    expect(getFetchUrlAt(1).searchParams.get('$skip')).toBe('100')
  })
})

describe('createYouTrackSprint', () => {
  test('creates sprint with converted timestamps and previous sprint link', async () => {
    const start = '2024-01-15T00:00:00.000Z'
    const finish = '2024-01-22T00:00:00.000Z'
    mockFetchResponse(
      makeSprintResponse({
        start: new Date(start).getTime(),
        finish: new Date(finish).getTime(),
      }),
    )

    const sprint = await createYouTrackSprint(config, 'agile-1', {
      name: 'Sprint 1',
      goal: 'Ship it',
      start,
      finish,
      previousSprintId: 'sprint-0',
      isDefault: true,
    })

    expect(sprint).toEqual({
      id: 'sprint-1',
      agileId: 'agile-1',
      name: 'Sprint 1',
      start,
      finish,
      archived: false,
      goal: 'Ship it',
      isDefault: true,
      unresolvedIssuesCount: 7,
    })
    expect(getFetchUrlAt(0).pathname).toBe('/api/agiles/agile-1/sprints')
    expect(getFetchUrlAt(0).searchParams.get('fields')).toBe(
      'id,name,archived,goal,isDefault,start,finish,unresolvedIssuesCount',
    )
    expect(getFetchMethodAt(0)).toBe('POST')
    expect(getFetchBodyAt(0)).toEqual({
      name: 'Sprint 1',
      goal: 'Ship it',
      start: new Date(start).getTime(),
      finish: new Date(finish).getTime(),
      previousSprint: { id: 'sprint-0' },
      isDefault: true,
    })
  })

  test('rejects invalid start and finish timestamps before sending request', async () => {
    mockFetchResponse(makeSprintResponse())

    await expect(
      createYouTrackSprint(config, 'agile-1', {
        name: 'Sprint 1',
        start: 'not-a-date',
      }),
    ).rejects.toBeInstanceOf(YouTrackClassifiedError)

    expect(fetchMock?.mock.calls).toHaveLength(0)

    await expect(
      createYouTrackSprint(config, 'agile-1', {
        name: 'Sprint 1',
        finish: 'also-not-a-date',
      }),
    ).rejects.toBeInstanceOf(YouTrackClassifiedError)

    expect(fetchMock?.mock.calls).toHaveLength(0)
  })

  test('rejects impossible ISO datetimes before sending request', async () => {
    mockFetchResponse(makeSprintResponse())

    await expect(
      createYouTrackSprint(config, 'agile-1', {
        name: 'Sprint 1',
        start: '2024-02-30T00:00:00.000Z',
      }),
    ).rejects.toBeInstanceOf(YouTrackClassifiedError)

    expect(fetchMock?.mock.calls).toHaveLength(0)

    await expect(
      createYouTrackSprint(config, 'agile-1', {
        name: 'Sprint 1',
        finish: '2024-02-30T00:00:00.000Z',
      }),
    ).rejects.toBeInstanceOf(YouTrackClassifiedError)

    expect(fetchMock?.mock.calls).toHaveLength(0)
  })
})

describe('updateYouTrackSprint', () => {
  test('updates sprint with null reset fields and archived flag', async () => {
    mockFetchResponse(
      makeSprintResponse({
        id: 'sprint-2',
        name: 'Sprint 2',
        archived: true,
        goal: 'Updated goal',
        isDefault: false,
        start: null,
        finish: null,
      }),
    )

    const sprint = await updateYouTrackSprint(config, 'agile-1', 'sprint-2', {
      name: 'Sprint 2',
      goal: 'Updated goal',
      start: null,
      finish: null,
      previousSprintId: null,
      isDefault: false,
      archived: true,
    })

    expect(sprint).toEqual({
      id: 'sprint-2',
      agileId: 'agile-1',
      name: 'Sprint 2',
      start: undefined,
      finish: undefined,
      archived: true,
      goal: 'Updated goal',
      isDefault: false,
      unresolvedIssuesCount: 7,
    })
    expect(getFetchUrlAt(0).pathname).toBe('/api/agiles/agile-1/sprints/sprint-2')
    expect(getFetchMethodAt(0)).toBe('POST')
    expect(getFetchBodyAt(0)).toEqual({
      name: 'Sprint 2',
      goal: 'Updated goal',
      start: null,
      finish: null,
      previousSprint: null,
      isDefault: false,
      archived: true,
    })
  })

  test('clears sprint goal when null is provided', async () => {
    mockFetchResponse(makeSprintResponse({ id: 'sprint-3', goal: null }))

    const sprint = await updateYouTrackSprint(config, 'agile-1', 'sprint-3', {
      goal: null,
    })

    expect(sprint.goal).toBeNull()
    expect(getFetchBodyAt(0)).toEqual({ goal: null })
  })

  test('rejects invalid update timestamps before sending request', async () => {
    mockFetchResponse(makeSprintResponse())

    await expect(
      updateYouTrackSprint(config, 'agile-1', 'sprint-3', {
        start: 'not-a-date',
      }),
    ).rejects.toBeInstanceOf(YouTrackClassifiedError)

    expect(fetchMock?.mock.calls).toHaveLength(0)

    await expect(
      updateYouTrackSprint(config, 'agile-1', 'sprint-3', {
        finish: 'also-not-a-date',
      }),
    ).rejects.toBeInstanceOf(YouTrackClassifiedError)

    expect(fetchMock?.mock.calls).toHaveLength(0)
  })

  test('rejects impossible ISO datetimes when updating before sending request', async () => {
    mockFetchResponse(makeSprintResponse())

    await expect(
      updateYouTrackSprint(config, 'agile-1', 'sprint-3', {
        start: '2024-02-30T00:00:00.000Z',
      }),
    ).rejects.toBeInstanceOf(YouTrackClassifiedError)

    expect(fetchMock?.mock.calls).toHaveLength(0)

    await expect(
      updateYouTrackSprint(config, 'agile-1', 'sprint-3', {
        finish: '2024-02-30T00:00:00.000Z',
      }),
    ).rejects.toBeInstanceOf(YouTrackClassifiedError)

    expect(fetchMock?.mock.calls).toHaveLength(0)
  })
})

describe('assignYouTrackTaskToSprint', () => {
  test('resolves issue id and agile board before assigning sprint', async () => {
    mockFetchSequence([
      { data: { id: 'issue-db-1' } },
      {
        data: [
          { id: 'agile-1', sprints: [{ id: 'sprint-2' }] },
          { id: 'agile-2', sprints: [{ id: 'sprint-9' }] },
        ],
      },
      { data: null, status: 204 },
    ])

    const result = await assignYouTrackTaskToSprint(config, 'TEST-1', 'sprint-2')

    expect(result).toEqual({ taskId: 'TEST-1', sprintId: 'sprint-2' })
    expect(getFetchUrlAt(0).pathname).toBe('/api/issues/TEST-1')
    expect(getFetchUrlAt(0).searchParams.get('fields')).toBe('id')
    expect(getFetchMethodAt(0)).toBe('GET')
    expect(getFetchUrlAt(1).pathname).toBe('/api/agiles')
    expect(getFetchUrlAt(1).searchParams.get('fields')).toBe('id,sprints(id)')
    expect(getFetchUrlAt(1).searchParams.get('$top')).toBe('100')
    expect(getFetchMethodAt(1)).toBe('GET')
    expect(getFetchUrlAt(2).pathname).toBe('/api/agiles/agile-1/sprints/sprint-2/issues')
    expect(getFetchMethodAt(2)).toBe('POST')
    expect(getFetchBodyAt(2)).toEqual({ id: 'issue-db-1', $type: 'Issue' })
  })

  test('searches across paginated agile results when resolving sprint ownership', async () => {
    mockFetchSequence([
      { data: { id: 'issue-db-1' } },
      {
        data: Array.from({ length: 100 }, (_, index) => ({
          id: `agile-${index + 1}`,
          sprints: [{ id: `other-${index}` }],
        })),
      },
      {
        data: [{ id: 'agile-101', sprints: [{ id: 'sprint-2' }] }],
      },
      { data: null, status: 204 },
    ])

    const result = await assignYouTrackTaskToSprint(config, 'TEST-1', 'sprint-2')

    expect(result).toEqual({ taskId: 'TEST-1', sprintId: 'sprint-2' })
    expect(getFetchUrlAt(1).searchParams.get('$skip')).toBe('0')
    expect(getFetchUrlAt(2).searchParams.get('$skip')).toBe('100')
    expect(getFetchUrlAt(3).pathname).toBe('/api/agiles/agile-101/sprints/sprint-2/issues')
  })

  test('throws classified error on api failure', async () => {
    mockFetchError(404, { error: 'Issue not found' })

    await expect(assignYouTrackTaskToSprint(config, 'TEST-1', 'sprint-2')).rejects.toBeInstanceOf(
      YouTrackClassifiedError,
    )
  })
})
