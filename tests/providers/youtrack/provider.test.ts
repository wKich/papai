import { afterEach, beforeEach, describe, expect, mock, test } from 'bun:test'

import { z } from 'zod'

import { YouTrackApiError } from '../../../src/providers/youtrack/client.js'
import type { YouTrackConfig } from '../../../src/providers/youtrack/client.js'
import { YouTrackProvider } from '../../../src/providers/youtrack/index.js'
import { restoreFetch, setMockFetch } from '../../test-helpers.js'

// Store reference to current fetch mock for call inspection
let fetchMock: ReturnType<typeof mock<(url: string, init: RequestInit) => Promise<Response>>> | undefined

const createConfig = (): YouTrackConfig => ({
  baseUrl: 'https://test.youtrack.cloud',
  token: 'test-token',
})

const installFetchMock = (handler: () => Promise<Response>): void => {
  const mocked = mock<(url: string, init: RequestInit) => Promise<Response>>(handler)
  fetchMock = mocked
  setMockFetch((url: string, init: RequestInit) => mocked(url, init))
}

const mockFetchResponse = (data: unknown, status = 200): void => {
  installFetchMock(() =>
    Promise.resolve(
      new Response(JSON.stringify(data), {
        status,
        headers: { 'Content-Type': 'application/json' },
      }),
    ),
  )
}

const mockFetchNoContent = (): void => {
  installFetchMock(() => Promise.resolve(new Response(null, { status: 204 })))
}

/** Schema for a mock fetch call tuple: [url, init] */
const FetchCallSchema = z.tuple([z.string(), z.looseObject({ body: z.string().optional() })])

/** Schema for request body with custom fields */
const RequestBodySchema = z.object({
  customFields: z.array(z.unknown()).optional(),
})

/** Helper to extract the request body sent to the mocked fetch. */
const getLastFetchBody = (): unknown => {
  if (fetchMock === undefined) return undefined
  const lastCall = fetchMock.mock.calls[0]
  const parsed = FetchCallSchema.safeParse(lastCall)
  if (!parsed.success) return undefined
  const [, init] = parsed.data
  if (init.body === undefined) return undefined
  return JSON.parse(init.body) as unknown
}

/** Helper to extract the URL of the last fetch call. */
const getLastFetchUrl = (): URL => {
  if (fetchMock === undefined) return new URL('')
  const lastCall = fetchMock.mock.calls[0]
  const parsed = FetchCallSchema.safeParse(lastCall)
  if (!parsed.success) return new URL('')
  const [url] = parsed.data
  return new URL(url)
}

/** Parse and validate request body has customFields. */
const parseCustomFields = (obj: unknown): unknown[] => {
  const parsed = RequestBodySchema.safeParse(obj)
  if (!parsed.success) {
    throw new Error('Expected body to have customFields')
  }
  if (parsed.data.customFields === undefined) {
    throw new Error('Expected customFields to be present')
  }
  return parsed.data.customFields
}

describe('YouTrackProvider', () => {
  let provider: YouTrackProvider

  beforeEach(() => {
    provider = new YouTrackProvider(createConfig())
    fetchMock = undefined
  })

  afterEach(() => {
    restoreFetch()
    fetchMock = undefined
  })

  describe('identity', () => {
    test('has correct name', () => {
      expect(provider.name).toBe('youtrack')
    })

    test('has expected capabilities', () => {
      // Tasks (full support)
      expect(provider.capabilities.has('tasks.delete')).toBe(true)
      expect(provider.capabilities.has('tasks.relations')).toBe(true)
      // Projects (full CRUD support)
      expect(provider.capabilities.has('projects.read')).toBe(true)
      expect(provider.capabilities.has('projects.list')).toBe(true)
      expect(provider.capabilities.has('projects.create')).toBe(true)
      expect(provider.capabilities.has('projects.update')).toBe(true)
      // Comments (full CRUD support)
      expect(provider.capabilities.has('comments.read')).toBe(true)
      expect(provider.capabilities.has('comments.create')).toBe(true)
      expect(provider.capabilities.has('comments.update')).toBe(true)
      expect(provider.capabilities.has('comments.delete')).toBe(true)
      // Labels (full CRUD + assignment)
      expect(provider.capabilities.has('labels.list')).toBe(true)
      expect(provider.capabilities.has('labels.create')).toBe(true)
      expect(provider.capabilities.has('labels.update')).toBe(true)
      expect(provider.capabilities.has('labels.delete')).toBe(true)
      expect(provider.capabilities.has('labels.assign')).toBe(true)
      // Statuses (YouTrack uses custom fields, not explicit status management)
      expect(provider.capabilities.has('statuses.list')).toBe(false)
      expect(provider.capabilities.has('statuses.create')).toBe(false)
    })

    test('has config requirements', () => {
      expect(provider.configRequirements).toHaveLength(2)
      expect(provider.configRequirements[0]!.key).toBe('youtrack_url')
      expect(provider.configRequirements[1]!.key).toBe('youtrack_token')
    })

    test('returns prompt addendum about YouTrack', () => {
      const addendum = provider.getPromptAddendum()
      expect(addendum).toContain('YouTrack')
      expect(addendum).toContain('State')
    })
  })

  describe('createTask', () => {
    test('creates issue and returns mapped task', async () => {
      mockFetchResponse({
        id: '2-1',
        idReadable: 'TEST-1',
        summary: 'New task',
        description: 'A description',
        project: { id: '0-1', shortName: 'TEST' },
        created: 1700000000000,
        updated: 1700000000000,
        customFields: [{ $type: 'SingleEnumIssueCustomField', name: 'Priority', value: { name: 'Normal' } }],
        tags: [],
        links: [],
      })

      const task = await provider.createTask({
        projectId: '0-1',
        title: 'New task',
        description: 'A description',
      })

      expect(task.id).toBe('TEST-1')
      expect(task.title).toBe('New task')
      expect(task.description).toBe('A description')
      expect(task.priority).toBe('Normal')
      expect(task.url).toBe('https://test.youtrack.cloud/issue/TEST-1')
    })

    test('sends custom fields for priority and status', async () => {
      mockFetchResponse({
        id: '2-2',
        idReadable: 'TEST-2',
        summary: 'Task with fields',
        project: { id: '0-1' },
        created: 1700000000000,
        updated: 1700000000000,
        customFields: [],
        tags: [],
        links: [],
      })

      await provider.createTask({
        projectId: '0-1',
        title: 'Task with fields',
        priority: 'Critical',
        status: 'In Progress',
      })

      const customFields = parseCustomFields(getLastFetchBody())
      expect(customFields).toEqual([
        { name: 'Priority', $type: 'SingleEnumIssueCustomField', value: { name: 'Critical' } },
        { name: 'State', $type: 'StateIssueCustomField', value: { name: 'In Progress' } },
      ])
    })
  })

  describe('getTask', () => {
    test('fetches and maps issue with relations', async () => {
      mockFetchResponse({
        id: '2-5',
        idReadable: 'TEST-5',
        summary: 'Task with links',
        created: 1700000000000,
        updated: 1700000000001,
        project: { id: '0-1', shortName: 'TEST' },
        customFields: [{ $type: 'StateIssueCustomField', name: 'State', value: { name: 'Open' } }],
        tags: [{ id: 'tag-1', name: 'bug', color: { background: '#ff0000' } }],
        links: [
          {
            direction: 'OUTWARD',
            linkType: { id: 'lt-1', name: 'Depend', sourceToTarget: 'is required for' },
            issues: [{ id: '2-6', idReadable: 'TEST-6', summary: 'Blocked task' }],
          },
        ],
      })

      const task = await provider.getTask('TEST-5')

      expect(task.id).toBe('TEST-5')
      expect(task.status).toBe('Open')
      expect(task.labels).toHaveLength(1)
      expect(task.labels![0]!.name).toBe('bug')
      expect(task.labels![0]!.color).toBe('#ff0000')
      expect(task.relations).toHaveLength(1)
      expect(task.relations![0]!.type).toBe('blocks')
      expect(task.relations![0]!.taskId).toBe('TEST-6')
    })
  })

  describe('updateTask', () => {
    test('sends POST to update issue', async () => {
      mockFetchResponse({
        id: '2-1',
        idReadable: 'TEST-1',
        summary: 'Updated title',
        project: { id: '0-1' },
        created: 1700000000000,
        updated: 1700000000000,
        customFields: [],
        tags: [],
        links: [],
      })

      const task = await provider.updateTask('TEST-1', { title: 'Updated title' })

      expect(task.title).toBe('Updated title')
      const url = getLastFetchUrl()
      expect(url.pathname).toContain('/api/issues/TEST-1')
    })
  })

  describe('listTasks', () => {
    test('queries issues by project', async () => {
      mockFetchResponse([
        {
          id: '2-1',
          idReadable: 'TEST-1',
          summary: 'First',
          project: { id: '0-1', shortName: 'TEST' },
          customFields: [],
        },
        {
          id: '2-2',
          idReadable: 'TEST-2',
          summary: 'Second',
          project: { id: '0-1', shortName: 'TEST' },
          customFields: [],
        },
      ])

      const tasks = await provider.listTasks('TEST')

      expect(tasks).toHaveLength(2)
      expect(tasks[0]!.id).toBe('TEST-1')
      expect(tasks[1]!.id).toBe('TEST-2')
    })
  })

  describe('searchTasks', () => {
    test('searches with query parameter', async () => {
      mockFetchResponse([
        {
          id: '2-3',
          idReadable: 'TEST-3',
          summary: 'Bug fix',
          project: { id: '0-1', shortName: 'TEST' },
          customFields: [],
        },
      ])

      const results = await provider.searchTasks({ query: 'bug' })

      expect(results).toHaveLength(1)
      expect(results[0]!.id).toBe('TEST-3')
      const url = getLastFetchUrl()
      expect(url.searchParams.get('query')).toBe('bug')
    })

    test('includes project filter in query', async () => {
      mockFetchResponse([])

      await provider.searchTasks({ query: 'test', projectId: 'PROJ' })

      const url = getLastFetchUrl()
      expect(url.searchParams.get('query')).toBe('project: {PROJ} test')
    })
  })

  describe('deleteTask', () => {
    test('sends DELETE request', async () => {
      mockFetchNoContent()
      const result = await provider.deleteTask('TEST-1')
      expect(result.id).toBe('TEST-1')
    })
  })

  describe('comments', () => {
    test('addComment creates comment', async () => {
      mockFetchResponse({
        id: 'comment-1',
        text: 'Hello',
        author: { id: 'u-1', login: 'john', name: 'John' },
        created: 1700000000000,
      })

      const comment = await provider.addComment('TEST-1', 'Hello')
      expect(comment.id).toBe('comment-1')
      expect(comment.body).toBe('Hello')
      expect(comment.author).toBe('John')
    })

    test('getComments lists comments', async () => {
      mockFetchResponse([
        { id: 'c-1', text: 'First', author: { id: 'u-alice', login: 'alice' }, created: 1700000000000 },
        { id: 'c-2', text: 'Second', author: { id: 'u-bob', login: 'bob', name: 'Bob' }, created: 1700000001000 },
      ])

      const comments = await provider.getComments('TEST-1')
      expect(comments).toHaveLength(2)
      expect(comments[0]!.author).toBe('alice')
      expect(comments[1]!.author).toBe('Bob')
    })

    test('updateComment sends POST', async () => {
      mockFetchResponse({
        id: 'c-1',
        text: 'Updated text',
        author: { id: 'u-alice', login: 'alice' },
        created: 1700000000000,
      })

      const comment = await provider.updateComment({
        taskId: 'TEST-1',
        commentId: 'c-1',
        body: 'Updated text',
      })
      expect(comment.body).toBe('Updated text')
    })
  })

  describe('labels (tags)', () => {
    test('listLabels returns tags', async () => {
      mockFetchResponse([
        { id: 'tag-1', name: 'bug', color: { background: '#ff0000' } },
        { id: 'tag-2', name: 'feature', color: { background: '#00ff00' } },
      ])

      const labels = await provider.listLabels()
      expect(labels).toHaveLength(2)
      expect(labels[0]!.name).toBe('bug')
      expect(labels[0]!.color).toBe('#ff0000')
    })

    test('createLabel creates tag', async () => {
      mockFetchResponse({ id: 'tag-3', name: 'docs', color: null })

      const label = await provider.createLabel({ name: 'docs' })
      expect(label.id).toBe('tag-3')
      expect(label.name).toBe('docs')
    })

    test('removeLabel deletes tag', async () => {
      mockFetchNoContent()
      const result = await provider.removeLabel('tag-1')
      expect(result.id).toBe('tag-1')
    })
  })

  describe('URL builders', () => {
    test('buildTaskUrl returns correct URL', () => {
      expect(provider.buildTaskUrl('TEST-1')).toBe('https://test.youtrack.cloud/issue/TEST-1')
    })

    test('buildProjectUrl returns correct URL', () => {
      expect(provider.buildProjectUrl('proj-1')).toBe('https://test.youtrack.cloud/projects/proj-1')
    })
  })

  describe('classifyError', () => {
    test('classifies 401 as auth-failed', () => {
      const error = new YouTrackApiError('Unauthorized', 401, {})
      const result = provider.classifyError(error)
      expect(result.code).toBe('auth-failed')
    })

    test('classifies 404 as task-not-found when message contains issue', () => {
      const error = new YouTrackApiError('YouTrack API GET /api/issues/TEST-1 returned 404', 404, {})
      const result = provider.classifyError(error)
      expect(result.code).toBe('task-not-found')
    })

    test('classifies 429 as rate-limited', () => {
      const error = new YouTrackApiError('Too many requests', 429, {})
      const result = provider.classifyError(error)
      expect(result.code).toBe('rate-limited')
    })

    test('classifies 400 as validation-failed', () => {
      const error = new YouTrackApiError('Bad request', 400, {})
      const result = provider.classifyError(error)
      expect(result.code).toBe('validation-failed')
    })

    test('classifies 500 as unexpected', () => {
      const error = new YouTrackApiError('Server error', 500, {})
      const result = provider.classifyError(error)
      expect(result.code).toBe('unexpected')
    })

    test('classifies non-YouTrackApiError as unexpected', () => {
      const error = new Error('Some internal processing error')
      const result = provider.classifyError(error)
      expect(result.code).toBe('unexpected')
    })
  })

  describe('updateRelation', () => {
    test('calls remove then add commands in sequence', async () => {
      // First fetch: get task with links to find relation
      mockFetchResponse({
        id: '2-5',
        idReadable: 'TEST-5',
        summary: 'Task with links',
        links: [
          {
            id: 'link-1',
            direction: 'OUTWARD',
            linkType: { id: 'lt-1', name: 'Depend', sourceToTarget: 'is required for' },
            issues: [{ id: '2-6', idReadable: 'TEST-6', summary: 'Related task' }],
          },
        ],
      })

      const testProvider = new YouTrackProvider(createConfig())
      const result = await testProvider.updateRelation('TEST-5', 'TEST-6', 'related')

      // Should return the result from add (which has the new type)
      expect(result.taskId).toBe('TEST-5')
      expect(result.relatedTaskId).toBe('TEST-6')
      expect(result.type).toBe('related')
    })

    test('throws when relation not found without calling add', async () => {
      // Task has no links matching the related task
      mockFetchResponse({
        id: '2-5',
        idReadable: 'TEST-5',
        summary: 'Task with no matching links',
        links: [],
      })

      const testProvider = new YouTrackProvider(createConfig())
      const promise = testProvider.updateRelation('TEST-5', 'NON-EXISTENT', 'related')

      await expect(promise).rejects.toThrow('Relation not found')
      // The fetch should only be called once (for the get task to find the link)
      expect(fetchMock?.mock.calls).toHaveLength(1)
    })
  })
})
