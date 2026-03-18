import { afterEach, beforeEach, describe, expect, mock, test } from 'bun:test'

import { YouTrackApiError } from '../../../src/providers/youtrack/client.js'
import type { YouTrackConfig } from '../../../src/providers/youtrack/client.js'
import { YouTrackProvider } from '../../../src/providers/youtrack/index.js'

// Mock global fetch
const originalFetch = globalThis.fetch

const createConfig = (): YouTrackConfig => ({
  baseUrl: 'https://test.youtrack.cloud',
  token: 'test-token',
})

const mockFetchResponse = (data: unknown, status = 200): void => {
  globalThis.fetch = mock(() =>
    Promise.resolve(
      new Response(JSON.stringify(data), {
        status,
        headers: { 'Content-Type': 'application/json' },
      }),
    ),
  ) as unknown as typeof fetch
}

const mockFetchNoContent = (): void => {
  globalThis.fetch = mock(() => Promise.resolve(new Response(null, { status: 204 }))) as unknown as typeof fetch
}

/** Helper to extract the request body sent to the mocked fetch. */
const getLastFetchBody = (): unknown => {
  const mockFn = globalThis.fetch as unknown as ReturnType<typeof mock>
  const lastCall = mockFn.mock.calls[0] as [string, { body?: string }] | undefined
  if (lastCall?.[1]?.body === undefined) return undefined
  return JSON.parse(lastCall[1].body) as unknown
}

/** Helper to extract the URL of the last fetch call. */
const getLastFetchUrl = (): URL => {
  const mockFn = globalThis.fetch as unknown as ReturnType<typeof mock>
  const lastCall = mockFn.mock.calls[0] as [string] | undefined
  return new URL(lastCall?.[0] ?? '')
}

describe('YouTrackProvider', () => {
  let provider: YouTrackProvider

  beforeEach(() => {
    provider = new YouTrackProvider(createConfig())
  })

  afterEach(() => {
    globalThis.fetch = originalFetch
  })

  describe('identity', () => {
    test('has correct name', () => {
      expect(provider.name).toBe('youtrack')
    })

    test('has expected capabilities', () => {
      expect(provider.capabilities.has('tasks.delete')).toBe(true)
      expect(provider.capabilities.has('tasks.relations')).toBe(true)
      expect(provider.capabilities.has('projects.crud')).toBe(true)
      expect(provider.capabilities.has('comments.crud')).toBe(true)
      expect(provider.capabilities.has('labels.crud')).toBe(true)
      expect(provider.capabilities.has('statuses.crud')).toBe(false)
      expect(provider.capabilities.has('tasks.archive')).toBe(false)
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
        customFields: [
          {
            $type: 'SingleEnumIssueCustomField',
            projectCustomField: { field: { name: 'Priority' } },
            value: { name: 'Normal' },
          },
        ],
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

      const body = getLastFetchBody() as { customFields?: unknown[] }
      expect(body.customFields).toEqual([
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
        project: { id: '0-1', shortName: 'TEST' },
        customFields: [
          {
            $type: 'StateIssueCustomField',
            projectCustomField: { field: { name: 'State' } },
            value: { name: 'Open' },
          },
        ],
        tags: [{ id: 'tag-1', name: 'bug', color: { background: '#ff0000' } }],
        links: [
          {
            direction: 'OUTWARD',
            linkType: { name: 'Depend', sourceToTarget: 'is required for' },
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
        author: { login: 'john', name: 'John' },
        created: 1700000000000,
      })

      const comment = await provider.addComment('TEST-1', 'Hello')
      expect(comment.id).toBe('comment-1')
      expect(comment.body).toBe('Hello')
      expect(comment.author).toBe('John')
    })

    test('getComments lists comments', async () => {
      mockFetchResponse([
        { id: 'c-1', text: 'First', author: { login: 'alice' }, created: 1700000000000 },
        { id: 'c-2', text: 'Second', author: { name: 'Bob' }, created: 1700000001000 },
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
        author: { login: 'alice' },
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
      const error = new Error('Network failure')
      const result = provider.classifyError(error)
      expect(result.code).toBe('unexpected')
    })
  })
})
