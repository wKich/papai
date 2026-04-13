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
    // First call: get project shortName
    // Second call: list issues
    let callCount = 0
    installFetchMock(() => {
      callCount++
      if (callCount === 1) {
        return Promise.resolve(
          new Response(JSON.stringify({ id: '39-883', shortName: 'TEST', name: 'Test Project' }), {
            status: 200,
            headers: { 'Content-Type': 'application/json' },
          }),
        )
      }
      return Promise.resolve(
        new Response(
          JSON.stringify([
            makeIssueListResponse(),
            makeIssueListResponse({ id: '2-2', idReadable: 'TEST-2', summary: 'Second task' }),
          ]),
          { status: 200, headers: { 'Content-Type': 'application/json' } },
        ),
      )
    })

    const items = await listYouTrackTasks(config, '39-883')

    expect(items).toHaveLength(2)
    expect(items[0]!.id).toBe('TEST-1')
    expect(items[0]!.title).toBe('Test task')
    expect(items[0]!.status).toBe('Open')
    expect(items[0]!.priority).toBe('Normal')
    expect(items[0]!.url).toBe('https://test.youtrack.cloud/issue/TEST-1')
    expect(items[1]!.id).toBe('TEST-2')
    expect(items[1]!.title).toBe('Second task')
  })

  test('fetches project shortName and uses it in query', async () => {
    let callCount = 0
    installFetchMock(() => {
      callCount++
      if (callCount === 1) {
        return Promise.resolve(
          new Response(JSON.stringify({ id: '39-883', shortName: 'DEMO', name: 'Demo Project' }), {
            status: 200,
            headers: { 'Content-Type': 'application/json' },
          }),
        )
      }
      return Promise.resolve(
        new Response(JSON.stringify([]), { status: 200, headers: { 'Content-Type': 'application/json' } }),
      )
    })

    await listYouTrackTasks(config, '39-883')

    // Get the second call (issues search)
    const parsed = FetchCallSchema.safeParse(fetchMock.mock.calls[1])
    expect(parsed.success).toBe(true)
    if (!parsed.success) return
    const [url] = parsed.data
    const urlObj = new URL(url)
    expect(urlObj.pathname).toBe('/api/issues')
    expect(urlObj.searchParams.get('query')).toBe('project: {DEMO}')
    expect(urlObj.searchParams.get('$top')).toBe('100')
  })

  test('returns empty array when no issues', async () => {
    let callCount = 0
    installFetchMock(() => {
      callCount++
      if (callCount === 1) {
        return Promise.resolve(
          new Response(JSON.stringify({ id: '39-883', shortName: 'EMPTY', name: 'Empty Project' }), {
            status: 200,
            headers: { 'Content-Type': 'application/json' },
          }),
        )
      }
      return Promise.resolve(
        new Response(JSON.stringify([]), { status: 200, headers: { 'Content-Type': 'application/json' } }),
      )
    })

    const items = await listYouTrackTasks(config, '39-883')

    expect(items).toEqual([])
  })

  test('throws classified error on project fetch failure', async () => {
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

  test('includes status filter in query when provided', async () => {
    let callCount = 0
    installFetchMock(() => {
      callCount++
      if (callCount === 1) {
        return Promise.resolve(
          new Response(JSON.stringify({ id: '39-883', shortName: 'DEMO', name: 'Demo Project' }), {
            status: 200,
            headers: { 'Content-Type': 'application/json' },
          }),
        )
      }
      return Promise.resolve(
        new Response(JSON.stringify([]), { status: 200, headers: { 'Content-Type': 'application/json' } }),
      )
    })

    await listYouTrackTasks(config, '39-883', { status: 'In Progress' })

    const parsed = FetchCallSchema.safeParse(fetchMock.mock.calls[1])
    expect(parsed.success).toBe(true)
    if (!parsed.success) return
    const [url] = parsed.data
    const urlObj = new URL(url)
    expect(urlObj.searchParams.get('query')).toBe('project: {DEMO} State: {In Progress}')
  })

  test('includes priority filter in query when provided', async () => {
    let callCount = 0
    installFetchMock(() => {
      callCount++
      if (callCount === 1) {
        return Promise.resolve(
          new Response(JSON.stringify({ id: '39-883', shortName: 'DEMO', name: 'Demo Project' }), {
            status: 200,
            headers: { 'Content-Type': 'application/json' },
          }),
        )
      }
      return Promise.resolve(
        new Response(JSON.stringify([]), { status: 200, headers: { 'Content-Type': 'application/json' } }),
      )
    })

    await listYouTrackTasks(config, '39-883', { priority: 'high' })

    const parsed = FetchCallSchema.safeParse(fetchMock.mock.calls[1])
    expect(parsed.success).toBe(true)
    if (!parsed.success) return
    const [url] = parsed.data
    const urlObj = new URL(url)
    expect(urlObj.searchParams.get('query')).toBe('project: {DEMO} Priority: {high}')
  })

  test('includes assignee filter in query when provided', async () => {
    let callCount = 0
    installFetchMock(() => {
      callCount++
      if (callCount === 1) {
        return Promise.resolve(
          new Response(JSON.stringify({ id: '39-883', shortName: 'DEMO', name: 'Demo Project' }), {
            status: 200,
            headers: { 'Content-Type': 'application/json' },
          }),
        )
      }
      return Promise.resolve(
        new Response(JSON.stringify([]), { status: 200, headers: { 'Content-Type': 'application/json' } }),
      )
    })

    await listYouTrackTasks(config, '39-883', { assigneeId: 'john.doe' })

    const parsed = FetchCallSchema.safeParse(fetchMock.mock.calls[1])
    expect(parsed.success).toBe(true)
    if (!parsed.success) return
    const [url] = parsed.data
    const urlObj = new URL(url)
    expect(urlObj.searchParams.get('query')).toBe('project: {DEMO} Assignee: {john.doe}')
  })

  test('includes due date range filters in query when provided', async () => {
    let callCount = 0
    installFetchMock(() => {
      callCount++
      if (callCount === 1) {
        return Promise.resolve(
          new Response(JSON.stringify({ id: '39-883', shortName: 'DEMO', name: 'Demo Project' }), {
            status: 200,
            headers: { 'Content-Type': 'application/json' },
          }),
        )
      }
      return Promise.resolve(
        new Response(JSON.stringify([]), { status: 200, headers: { 'Content-Type': 'application/json' } }),
      )
    })

    await listYouTrackTasks(config, '39-883', { dueAfter: '2024-01-01', dueBefore: '2024-12-31' })

    const parsed = FetchCallSchema.safeParse(fetchMock.mock.calls[1])
    expect(parsed.success).toBe(true)
    if (!parsed.success) return
    const [url] = parsed.data
    const urlObj = new URL(url)
    expect(urlObj.searchParams.get('query')).toBe('project: {DEMO} Due date: >2024-01-01 Due date: <2024-12-31')
  })

  test('uses limit parameter for $top', async () => {
    let callCount = 0
    installFetchMock(() => {
      callCount++
      if (callCount === 1) {
        return Promise.resolve(
          new Response(JSON.stringify({ id: '39-883', shortName: 'DEMO', name: 'Demo Project' }), {
            status: 200,
            headers: { 'Content-Type': 'application/json' },
          }),
        )
      }
      return Promise.resolve(
        new Response(JSON.stringify([]), { status: 200, headers: { 'Content-Type': 'application/json' } }),
      )
    })

    await listYouTrackTasks(config, '39-883', { limit: 25 })

    const parsed = FetchCallSchema.safeParse(fetchMock.mock.calls[1])
    expect(parsed.success).toBe(true)
    if (!parsed.success) return
    const [url] = parsed.data
    const urlObj = new URL(url)
    expect(urlObj.searchParams.get('$top')).toBe('25')
  })

  test('uses page parameter with limit for pagination', async () => {
    let callCount = 0
    installFetchMock(() => {
      callCount++
      if (callCount === 1) {
        return Promise.resolve(
          new Response(JSON.stringify({ id: '39-883', shortName: 'DEMO', name: 'Demo Project' }), {
            status: 200,
            headers: { 'Content-Type': 'application/json' },
          }),
        )
      }
      return Promise.resolve(
        new Response(JSON.stringify([]), { status: 200, headers: { 'Content-Type': 'application/json' } }),
      )
    })

    await listYouTrackTasks(config, '39-883', { limit: 25, page: 3 })

    const parsed = FetchCallSchema.safeParse(fetchMock.mock.calls[1])
    expect(parsed.success).toBe(true)
    if (!parsed.success) return
    const [url] = parsed.data
    const urlObj = new URL(url)
    expect(urlObj.searchParams.get('$top')).toBe('25')
    expect(urlObj.searchParams.get('$skip')).toBe('50')
  })

  test('includes sort parameters in query when provided', async () => {
    let callCount = 0
    installFetchMock(() => {
      callCount++
      if (callCount === 1) {
        return Promise.resolve(
          new Response(JSON.stringify({ id: '39-883', shortName: 'DEMO', name: 'Demo Project' }), {
            status: 200,
            headers: { 'Content-Type': 'application/json' },
          }),
        )
      }
      return Promise.resolve(
        new Response(JSON.stringify([]), { status: 200, headers: { 'Content-Type': 'application/json' } }),
      )
    })

    await listYouTrackTasks(config, '39-883', { sortBy: 'priority', sortOrder: 'desc' })

    const parsed = FetchCallSchema.safeParse(fetchMock.mock.calls[1])
    expect(parsed.success).toBe(true)
    if (!parsed.success) return
    const [url] = parsed.data
    const urlObj = new URL(url)
    expect(urlObj.searchParams.get('query')).toBe('project: {DEMO} sort by: priority desc')
  })

  test('combines multiple filters in query', async () => {
    let callCount = 0
    installFetchMock(() => {
      callCount++
      if (callCount === 1) {
        return Promise.resolve(
          new Response(JSON.stringify({ id: '39-883', shortName: 'DEMO', name: 'Demo Project' }), {
            status: 200,
            headers: { 'Content-Type': 'application/json' },
          }),
        )
      }
      return Promise.resolve(
        new Response(JSON.stringify([]), { status: 200, headers: { 'Content-Type': 'application/json' } }),
      )
    })

    await listYouTrackTasks(config, '39-883', {
      status: 'Open',
      priority: 'urgent',
      assigneeId: 'jane.doe',
      limit: 10,
    })

    const parsed = FetchCallSchema.safeParse(fetchMock.mock.calls[1])
    expect(parsed.success).toBe(true)
    if (!parsed.success) return
    const [url] = parsed.data
    const urlObj = new URL(url)
    expect(urlObj.searchParams.get('query')).toBe(
      'project: {DEMO} State: {Open} Priority: {urgent} Assignee: {jane.doe}',
    )
    expect(urlObj.searchParams.get('$top')).toBe('10')
  })

  test('automatically paginates to fetch all tasks when more than 100 exist', async () => {
    let callCount = 0
    installFetchMock(() => {
      callCount++
      // First call: get project shortName
      if (callCount === 1) {
        return Promise.resolve(
          new Response(JSON.stringify({ id: '39-883', shortName: 'DEMO', name: 'Demo Project' }), {
            status: 200,
            headers: { 'Content-Type': 'application/json' },
          }),
        )
      }
      // Pages 1-3: return 100 items each (simulating large project)
      if (callCount === 2 || callCount === 3) {
        const items = Array.from({ length: 100 }, (_, i) =>
          makeIssueListResponse({
            id: `2-${i + (callCount - 2) * 100}`,
            idReadable: `DEMO-${i + (callCount - 2) * 100 + 1}`,
            summary: `Task ${i + (callCount - 2) * 100 + 1}`,
          }),
        )
        return Promise.resolve(
          new Response(JSON.stringify(items), { status: 200, headers: { 'Content-Type': 'application/json' } }),
        )
      }
      // Page 4: return 50 items (last page)
      if (callCount === 4) {
        const items = Array.from({ length: 50 }, (_, i) =>
          makeIssueListResponse({
            id: `2-${i + 200}`,
            idReadable: `DEMO-${i + 201}`,
            summary: `Task ${i + 201}`,
          }),
        )
        return Promise.resolve(
          new Response(JSON.stringify(items), { status: 200, headers: { 'Content-Type': 'application/json' } }),
        )
      }
      return Promise.resolve(
        new Response(JSON.stringify([]), { status: 200, headers: { 'Content-Type': 'application/json' } }),
      )
    })

    const items = await listYouTrackTasks(config, '39-883')

    // Should fetch all 250 tasks across 3 pages
    expect(items).toHaveLength(250)
    expect(items[0]!.id).toBe('DEMO-1')
    expect(items[99]!.id).toBe('DEMO-100')
    expect(items[199]!.id).toBe('DEMO-200')
    expect(items[249]!.id).toBe('DEMO-250')
    // Verify multiple API calls were made
    // 1 project + 3 pages
    expect(callCount).toBe(4)
  })

  test('respects maxPages limit to prevent excessive API calls', async () => {
    let callCount = 0
    installFetchMock(() => {
      callCount++
      if (callCount === 1) {
        return Promise.resolve(
          new Response(JSON.stringify({ id: '39-883', shortName: 'DEMO', name: 'Demo Project' }), {
            status: 200,
            headers: { 'Content-Type': 'application/json' },
          }),
        )
      }
      // Always return full pages to simulate infinite data
      const items = Array.from({ length: 100 }, (_, i) =>
        makeIssueListResponse({
          id: `2-${i + (callCount - 2) * 100}`,
          idReadable: `DEMO-${i + (callCount - 2) * 100 + 1}`,
          summary: `Task ${i + (callCount - 2) * 100 + 1}`,
        }),
      )
      return Promise.resolve(
        new Response(JSON.stringify(items), { status: 200, headers: { 'Content-Type': 'application/json' } }),
      )
    })

    const items = await listYouTrackTasks(config, '39-883')

    // Should stop at maxPages (10 pages = 1000 items)
    expect(items).toHaveLength(1000)
    // 1 project + 10 pages
    expect(callCount).toBe(11)
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
    let callCount = 0
    installFetchMock(() => {
      callCount++
      if (callCount === 1) {
        return Promise.resolve(
          new Response(JSON.stringify({ id: '39-883', shortName: 'MY-PROJ', name: 'My Project' }), {
            status: 200,
            headers: { 'Content-Type': 'application/json' },
          }),
        )
      }
      return Promise.resolve(
        new Response(JSON.stringify([]), { status: 200, headers: { 'Content-Type': 'application/json' } }),
      )
    })

    await searchYouTrackTasks(config, { query: 'bug', projectId: '39-883' })

    // Get the second call (issues search)
    const parsed = FetchCallSchema.safeParse(fetchMock.mock.calls[1])
    expect(parsed.success).toBe(true)
    if (!parsed.success) return
    const [url] = parsed.data
    const urlObj = new URL(url)
    expect(urlObj.searchParams.get('query')).toBe('project: {MY-PROJ} bug')
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

  test('prepends assignee filter when assigneeId is provided', async () => {
    mockFetchResponse([])

    await searchYouTrackTasks(config, { query: 'bug fix', assigneeId: 'john.doe' })

    const url = getLastFetchUrl()
    expect(url.searchParams.get('query')).toBe('assignee: {john.doe} bug fix')
  })

  test('prepends both assignee and project filters when both are provided', async () => {
    let callCount = 0
    installFetchMock(() => {
      callCount++
      if (callCount === 1) {
        return Promise.resolve(
          new Response(JSON.stringify({ id: '39-883', shortName: 'MY-PROJ', name: 'My Project' }), {
            status: 200,
            headers: { 'Content-Type': 'application/json' },
          }),
        )
      }
      return Promise.resolve(
        new Response(JSON.stringify([]), { status: 200, headers: { 'Content-Type': 'application/json' } }),
      )
    })

    await searchYouTrackTasks(config, { query: 'bug', projectId: '39-883', assigneeId: 'john.doe' })

    // Get the second call (issues search)
    const parsed = FetchCallSchema.safeParse(fetchMock.mock.calls[1])
    expect(parsed.success).toBe(true)
    if (!parsed.success) return
    const [url] = parsed.data
    const urlObj = new URL(url)
    // Assignee filter comes first (prepended last), then project filter
    expect(urlObj.searchParams.get('query')).toBe('assignee: {john.doe} project: {MY-PROJ} bug')
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
