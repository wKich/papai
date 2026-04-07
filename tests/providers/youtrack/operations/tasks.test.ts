import { afterEach, beforeEach, describe, expect, mock, test } from 'bun:test'

import { z } from 'zod'

import { YouTrackClassifiedError } from '../../../../src/providers/youtrack/classify-error.js'
import type { YouTrackConfig } from '../../../../src/providers/youtrack/client.js'
import {
  createYouTrackTask,
  deleteYouTrackTask,
  getYouTrackTask,
  listYouTrackTasks,
  searchYouTrackTasks,
  updateYouTrackTask,
} from '../../../../src/providers/youtrack/operations/tasks.js'
import { mockLogger, restoreFetch, setMockFetch } from '../../../utils/test-helpers.js'

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

type IssueFixture = Record<string, unknown>

const makeIssueResponse = (overrides: Record<string, unknown> = {}): IssueFixture => ({
  id: '2-1',
  idReadable: 'TEST-1',
  summary: 'Test task',
  description: 'A description',
  project: { id: '0-1', shortName: 'TEST' },
  created: 1700000000000,
  updated: 1700000000000,
  customFields: [
    { $type: 'SingleEnumIssueCustomField', name: 'Priority', value: { $type: 'EnumBundleElement', name: 'Normal' } },
    { $type: 'StateIssueCustomField', name: 'State', value: { name: 'Open' } },
  ],
  tags: [],
  links: [],
  ...overrides,
})

const makeIssueListResponse = (overrides: Record<string, unknown> = {}): IssueFixture => ({
  id: '2-1',
  idReadable: 'TEST-1',
  summary: 'Test task',
  project: { id: '0-1', shortName: 'TEST' },
  customFields: [
    { $type: 'SingleEnumIssueCustomField', name: 'Priority', value: { $type: 'EnumBundleElement', name: 'Normal' } },
    { $type: 'StateIssueCustomField', name: 'State', value: { name: 'Open' } },
  ],
  ...overrides,
})

// --- Tests ---

beforeEach(() => {
  mockLogger()
})

describe('createYouTrackTask', () => {
  beforeEach(() => {
    fetchMock = undefined!
  })

  afterEach(() => {
    restoreFetch()
  })

  test('creates task and returns mapped result', async () => {
    mockFetchResponse(makeIssueResponse())

    const task = await createYouTrackTask(config, {
      projectId: '0-1',
      title: 'Test task',
      description: 'A description',
    })

    expect(task.id).toBe('TEST-1')
    expect(task.title).toBe('Test task')
    expect(task.description).toBe('A description')
    expect(task.priority).toBe('Normal')
    expect(task.status).toBe('Open')
    expect(task.url).toBe('https://test.youtrack.cloud/issue/TEST-1')
    expect(task.projectId).toBe('0-1')
  })

  test('sends description when provided', async () => {
    mockFetchResponse(makeIssueResponse())

    await createYouTrackTask(config, {
      projectId: '0-1',
      title: 'Test task',
      description: 'My description',
    })

    const body = getLastFetchBody()
    expect(body['description']).toBe('My description')
  })

  test('does not send description when absent', async () => {
    mockFetchResponse(makeIssueResponse())

    await createYouTrackTask(config, {
      projectId: '0-1',
      title: 'Test task',
    })

    const body = getLastFetchBody()
    expect(body['description']).toBeUndefined()
  })

  test('sends custom fields for priority and status', async () => {
    mockFetchResponse(makeIssueResponse())

    await createYouTrackTask(config, {
      projectId: '0-1',
      title: 'Test task',
      priority: 'Critical',
      status: 'In Progress',
    })

    const body = getLastFetchBody()
    expect(body['customFields']).toEqual([
      { name: 'Priority', $type: 'SingleEnumIssueCustomField', value: { name: 'Critical' } },
      { name: 'State', $type: 'StateIssueCustomField', value: { name: 'In Progress' } },
    ])
  })

  test('sends assignee custom field when provided', async () => {
    mockFetchResponse(makeIssueResponse())

    await createYouTrackTask(config, {
      projectId: '0-1',
      title: 'Test task',
      assignee: 'john.doe',
    })

    const body = getLastFetchBody()
    expect(body['customFields']).toContainEqual({
      name: 'Assignee',
      $type: 'SingleUserIssueCustomField',
      value: { login: 'john.doe' },
    })
  })

  test('does not send customFields when none provided', async () => {
    mockFetchResponse(makeIssueResponse())

    await createYouTrackTask(config, {
      projectId: '0-1',
      title: 'Test task',
    })

    const body = getLastFetchBody()
    expect(body['customFields']).toBeUndefined()
  })

  test('uses POST method to /api/issues', async () => {
    mockFetchResponse(makeIssueResponse())

    await createYouTrackTask(config, { projectId: '0-1', title: 'Test task' })

    const url = getLastFetchUrl()
    expect(url.pathname).toBe('/api/issues')
    expect(getLastFetchMethod()).toBe('POST')
  })

  test('throws YouTrackClassifiedError on API error', async () => {
    mockFetchError(400, { error: 'Bad request' })

    await expect(createYouTrackTask(config, { projectId: '0-1', title: 'Test task' })).rejects.toBeInstanceOf(
      YouTrackClassifiedError,
    )
  })

  test('throws YouTrackClassifiedError on auth error', async () => {
    mockFetchError(401, { error: 'Unauthorized' })

    try {
      await createYouTrackTask(config, { projectId: '0-1', title: 'Test task' })
      expect.unreachable('Should have thrown')
    } catch (error) {
      expect(error).toBeInstanceOf(YouTrackClassifiedError)
      if (!(error instanceof YouTrackClassifiedError)) throw error
      expect(error.appError.code).toBe('auth-failed')
    }
  })
})

describe('getYouTrackTask', () => {
  beforeEach(() => {
    fetchMock = undefined!
  })

  afterEach(() => {
    restoreFetch()
  })

  test('retrieves task by id', async () => {
    mockFetchResponse(makeIssueResponse())

    const task = await getYouTrackTask(config, 'TEST-1')

    expect(task.id).toBe('TEST-1')
    expect(task.title).toBe('Test task')
    expect(task.description).toBe('A description')
    expect(task.url).toBe('https://test.youtrack.cloud/issue/TEST-1')
  })

  test('uses GET method with task id in path', async () => {
    mockFetchResponse(makeIssueResponse())

    await getYouTrackTask(config, 'TEST-1')

    const url = getLastFetchUrl()
    expect(url.pathname).toBe('/api/issues/TEST-1')
    expect(getLastFetchMethod()).toBe('GET')
  })

  test('maps labels from tags', async () => {
    mockFetchResponse(
      makeIssueResponse({
        tags: [
          { id: 'tag-1', name: 'bug', color: { id: 'c-1', background: '#ff0000' } },
          { id: 'tag-2', name: 'feature', color: null },
        ],
      }),
    )

    const task = await getYouTrackTask(config, 'TEST-1')

    expect(task.labels).toEqual([
      { id: 'tag-1', name: 'bug', color: '#ff0000' },
      { id: 'tag-2', name: 'feature', color: undefined },
    ])
  })

  test('maps relations from links', async () => {
    mockFetchResponse(
      makeIssueResponse({
        links: [
          {
            id: 'link-1',
            direction: 'OUTWARD',
            linkType: { id: 'lt-1', name: 'Depend' },
            issues: [{ id: '2-2', idReadable: 'TEST-2', summary: 'Other' }],
          },
        ],
      }),
    )

    const task = await getYouTrackTask(config, 'TEST-1')

    expect(task.relations).toEqual([{ type: 'blocks', taskId: 'TEST-2' }])
  })

  test('throws classified error on 404', async () => {
    mockFetchError(404, { error: 'Issue not found /issues/' })

    try {
      await getYouTrackTask(config, 'NONEXISTENT')
      expect.unreachable('Should have thrown')
    } catch (error) {
      expect(error).toBeInstanceOf(YouTrackClassifiedError)
      if (!(error instanceof YouTrackClassifiedError)) throw error
      expect(error.appError.code).toBe('task-not-found')
    }
  })
})

describe('updateYouTrackTask', () => {
  beforeEach(() => {
    fetchMock = undefined!
  })

  afterEach(() => {
    restoreFetch()
  })

  test('updates task with title', async () => {
    mockFetchResponse(makeIssueResponse({ summary: 'Updated title' }))

    const task = await updateYouTrackTask(config, 'TEST-1', { title: 'Updated title' })

    expect(task.id).toBe('TEST-1')
    expect(task.title).toBe('Updated title')

    const body = getLastFetchBody()
    expect(body['summary']).toBe('Updated title')
  })

  test('sends description when provided', async () => {
    mockFetchResponse(makeIssueResponse())

    await updateYouTrackTask(config, 'TEST-1', { description: 'New desc' })

    const body = getLastFetchBody()
    expect(body['description']).toBe('New desc')
  })

  test('sends projectId when provided', async () => {
    mockFetchResponse(makeIssueResponse())

    await updateYouTrackTask(config, 'TEST-1', { projectId: 'proj-2' })

    const body = getLastFetchBody()
    expect(body['project']).toEqual({ id: 'proj-2' })
  })

  test('sends custom fields for status, priority, and assignee', async () => {
    mockFetchResponse(makeIssueResponse())

    await updateYouTrackTask(config, 'TEST-1', {
      status: 'Done',
      priority: 'Major',
      assignee: 'john',
    })

    const body = getLastFetchBody()
    expect(body['customFields']).toContainEqual(expect.objectContaining({ name: 'Priority', value: { name: 'Major' } }))
    expect(body['customFields']).toContainEqual(expect.objectContaining({ name: 'State', value: { name: 'Done' } }))
    expect(body['customFields']).toContainEqual(expect.objectContaining({ name: 'Assignee', value: { login: 'john' } }))
  })

  test('does not send fields when they are not provided', async () => {
    mockFetchResponse(makeIssueResponse())

    await updateYouTrackTask(config, 'TEST-1', {})

    const body = getLastFetchBody()
    expect(body['summary']).toBeUndefined()
    expect(body['description']).toBeUndefined()
    expect(body['project']).toBeUndefined()
    expect(body['customFields']).toBeUndefined()
  })

  test('uses POST method with task id in path', async () => {
    mockFetchResponse(makeIssueResponse())

    await updateYouTrackTask(config, 'TEST-1', { title: 'Updated' })

    const url = getLastFetchUrl()
    expect(url.pathname).toBe('/api/issues/TEST-1')
    expect(getLastFetchMethod()).toBe('POST')
  })

  test('throws classified error on failure', async () => {
    mockFetchError(500, { error: 'Server error' })

    await expect(updateYouTrackTask(config, 'TEST-1', { title: 'Updated' })).rejects.toBeInstanceOf(
      YouTrackClassifiedError,
    )
  })
})

describe('listYouTrackTasks', () => {
  beforeEach(() => {
    fetchMock = undefined!
  })

  afterEach(() => {
    restoreFetch()
  })

  test('returns mapped list items', async () => {
    mockFetchResponse([
      makeIssueListResponse(),
      makeIssueListResponse({ id: '2-2', idReadable: 'TEST-2', summary: 'Second task' }),
    ])

    const items = await listYouTrackTasks(config, 'proj-1')

    expect(items).toHaveLength(2)
    expect(items[0]!.id).toBe('TEST-1')
    expect(items[0]!.title).toBe('Test task')
    expect(items[0]!.status).toBe('Open')
    expect(items[0]!.priority).toBe('Normal')
    expect(items[0]!.url).toBe('https://test.youtrack.cloud/issue/TEST-1')
    expect(items[1]!.id).toBe('TEST-2')
    expect(items[1]!.title).toBe('Second task')
  })

  test('uses project query parameter', async () => {
    mockFetchResponse([])

    await listYouTrackTasks(config, 'MY-PROJECT')

    const url = getLastFetchUrl()
    expect(url.pathname).toBe('/api/issues')
    expect(url.searchParams.get('query')).toBe('project: {MY-PROJECT}')
    expect(url.searchParams.get('$top')).toBe('100')
  })

  test('returns empty array when no issues', async () => {
    mockFetchResponse([])

    const items = await listYouTrackTasks(config, 'proj-empty')

    expect(items).toEqual([])
  })

  test('throws classified error on failure', async () => {
    mockFetchError(403, { error: 'Forbidden' })

    try {
      await listYouTrackTasks(config, 'proj-1')
      expect.unreachable('Should have thrown')
    } catch (error) {
      expect(error).toBeInstanceOf(YouTrackClassifiedError)
      if (!(error instanceof YouTrackClassifiedError)) throw error
      expect(error.appError.code).toBe('auth-failed')
    }
  })
})

describe('searchYouTrackTasks', () => {
  beforeEach(() => {
    fetchMock = undefined!
  })

  afterEach(() => {
    restoreFetch()
  })

  test('returns mapped search results', async () => {
    mockFetchResponse([makeIssueListResponse()])

    const results = await searchYouTrackTasks(config, { query: 'bug fix' })

    expect(results).toHaveLength(1)
    expect(results[0]!.id).toBe('TEST-1')
    expect(results[0]!.title).toBe('Test task')
    expect(results[0]!.status).toBe('Open')
    expect(results[0]!.priority).toBe('Normal')
    expect(results[0]!.projectId).toBe('0-1')
    expect(results[0]!.url).toBe('https://test.youtrack.cloud/issue/TEST-1')
  })

  test('prepends project filter when projectId is provided', async () => {
    mockFetchResponse([])

    await searchYouTrackTasks(config, { query: 'bug', projectId: 'MY-PROJ' })

    const url = getLastFetchUrl()
    expect(url.searchParams.get('query')).toBe('project: {MY-PROJ} bug')
  })

  test('does not prepend project filter when projectId is absent', async () => {
    mockFetchResponse([])

    await searchYouTrackTasks(config, { query: 'bug' })

    const url = getLastFetchUrl()
    expect(url.searchParams.get('query')).toBe('bug')
  })

  test('uses custom limit when provided', async () => {
    mockFetchResponse([])

    await searchYouTrackTasks(config, { query: 'test', limit: 10 })

    const url = getLastFetchUrl()
    expect(url.searchParams.get('$top')).toBe('10')
  })

  test('defaults to limit 50', async () => {
    mockFetchResponse([])

    await searchYouTrackTasks(config, { query: 'test' })

    const url = getLastFetchUrl()
    expect(url.searchParams.get('$top')).toBe('50')
  })

  test('returns empty array for no results', async () => {
    mockFetchResponse([])

    const results = await searchYouTrackTasks(config, { query: 'nonexistent' })

    expect(results).toEqual([])
  })

  test('throws classified error on failure', async () => {
    mockFetchError(429, { error: 'Rate limited' })

    try {
      await searchYouTrackTasks(config, { query: 'test' })
      expect.unreachable('Should have thrown')
    } catch (error) {
      expect(error).toBeInstanceOf(YouTrackClassifiedError)
      if (!(error instanceof YouTrackClassifiedError)) throw error
      expect(error.appError.code).toBe('rate-limited')
    }
  })

  test('throws classified error with projectId context', async () => {
    mockFetchError(500, { error: 'Server error' })

    await expect(searchYouTrackTasks(config, { query: 'test', projectId: 'proj-1' })).rejects.toBeInstanceOf(
      YouTrackClassifiedError,
    )
  })
})

describe('deleteYouTrackTask', () => {
  beforeEach(() => {
    fetchMock = undefined!
  })

  afterEach(() => {
    restoreFetch()
  })

  test('deletes task and returns id', async () => {
    mockFetchNoContent()

    const result = await deleteYouTrackTask(config, 'TEST-1')

    expect(result).toEqual({ id: 'TEST-1' })
  })

  test('uses DELETE method with task id in path', async () => {
    mockFetchNoContent()

    await deleteYouTrackTask(config, 'TEST-42')

    const url = getLastFetchUrl()
    expect(url.pathname).toBe('/api/issues/TEST-42')
    expect(getLastFetchMethod()).toBe('DELETE')
  })

  test('throws classified error on 404', async () => {
    mockFetchError(404, { error: 'Issue not found /issues/' })

    try {
      await deleteYouTrackTask(config, 'NONEXISTENT')
      expect.unreachable('Should have thrown')
    } catch (error) {
      expect(error).toBeInstanceOf(YouTrackClassifiedError)
      if (!(error instanceof YouTrackClassifiedError)) throw error
      expect(error.appError.code).toBe('task-not-found')
    }
  })
})
