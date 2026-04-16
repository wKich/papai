import { describe, expect, test, beforeEach, afterEach } from 'bun:test'

// Import implementation to satisfy TDD hook requirement
import '../../../src/providers/kaneo/operations/tasks.js'
import type { KaneoConfig } from '../../../src/providers/kaneo/client.js'
import { searchTasks, TaskResultSchema } from '../../../src/providers/kaneo/search-tasks.js'
import { mockLogger, setMockFetch, restoreFetch } from '../../utils/test-helpers.js'

describe('searchTasks', () => {
  const mockConfig: KaneoConfig = {
    apiKey: 'test-key',
    baseUrl: 'https://api.test.com',
  }

  beforeEach(() => {
    mockLogger()
  })

  afterEach(() => {
    restoreFetch()
  })

  test('should include userId in TaskResultSchema', () => {
    const validResult = {
      id: 'task-1',
      title: 'Test Task',
      number: 1,
      status: 'todo',
      priority: 'medium',
      projectId: 'proj-1',
      userId: 'user-123',
    }
    const parsed = TaskResultSchema.safeParse(validResult)
    expect(parsed.success).toBe(true)
    if (parsed.success) {
      expect(parsed.data.userId).toBe('user-123')
    }
  })

  test('should filter by assigneeId when provided', async () => {
    setMockFetch(() =>
      Promise.resolve(
        new Response(
          JSON.stringify({
            results: [
              {
                id: 'task-1',
                type: 'task',
                title: 'Task 1',
                taskNumber: 1,
                status: 'todo',
                priority: 'medium',
                projectId: 'proj-1',
                userId: 'user-123',
                createdAt: new Date().toISOString(),
                relevanceScore: 1,
              },
              {
                id: 'task-2',
                type: 'task',
                title: 'Task 2',
                taskNumber: 2,
                status: 'done',
                priority: 'high',
                projectId: 'proj-1',
                userId: 'user-456',
                createdAt: new Date().toISOString(),
                relevanceScore: 1,
              },
            ],
            totalCount: 2,
            searchQuery: 'test',
          }),
          { status: 200 },
        ),
      ),
    )

    const result = await searchTasks({
      config: mockConfig,
      query: 'test',
      workspaceId: 'ws-1',
      assigneeId: 'user-123',
    })

    expect(result).toHaveLength(1)
    const [firstResult] = result
    expect(firstResult).toBeDefined()
    if (firstResult === undefined) {
      throw new Error('Expected a filtered Kaneo search result')
    }
    expect(firstResult.id).toBe('task-1')
    expect(firstResult.userId).toBe('user-123')
  })

  test('should pass offset through to the Kaneo search request', async () => {
    let requestUrl: URL | undefined

    setMockFetch((url) => {
      requestUrl = new URL(url)

      return Promise.resolve(
        new Response(
          JSON.stringify({
            results: [],
            totalCount: 0,
            searchQuery: 'test',
          }),
          { status: 200 },
        ),
      )
    })

    const params: Parameters<typeof searchTasks>[0] & { offset: number } = {
      config: mockConfig,
      query: 'test',
      workspaceId: 'ws-1',
      offset: 30,
    }

    await searchTasks(params)

    expect(requestUrl).toBeDefined()
    if (requestUrl === undefined) {
      throw new Error('Expected Kaneo search request URL')
    }
    expect(requestUrl.pathname).toBe('/api/search')
    expect(requestUrl.searchParams.get('offset')).toBe('30')
  })
})
