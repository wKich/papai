import { beforeEach, describe, expect, mock, test } from 'bun:test'

import type { KaneoConfig } from '../../src/kaneo/client.js'
import { TaskResource } from '../../src/kaneo/index.js'

// Helper to set fetch mock
// Object.assign returns 'any' which satisfies globalThis.fetch assignment
function setMockFetch(mockFn: () => Promise<Response>): void {
  const originalFetch = globalThis.fetch
  // Assign required fetch properties to the mock function
  const mockWithProperties = Object.assign(mockFn, {
    preconnect: originalFetch.preconnect,
  })
  // Assignment is allowed because Object.assign returns 'any'
  globalThis.fetch = mockWithProperties
}

describe('TaskResource', () => {
  const mockConfig: KaneoConfig = {
    apiKey: 'test-key',
    baseUrl: 'https://api.test.com',
  }

  beforeEach(() => {
    mock.restore()
  })

  describe('create', () => {
    test('creates task with required fields', async () => {
      const mockFetch = mock(() =>
        Promise.resolve(
          new Response(
            JSON.stringify({
              id: 'task-1',
              title: 'Test Task',
              number: 42,
              status: 'todo',
              priority: 'no-priority',
              description: '',
              createdAt: '2026-03-01T00:00:00Z',
              dueDate: null,
              projectId: 'proj-1',
              userId: null,
            }),
            { status: 200 },
          ),
        ),
      )
      setMockFetch(mockFetch)

      const resource = new TaskResource(mockConfig)
      const result = await resource.create({
        projectId: 'proj-1',
        title: 'Test Task',
      })

      expect(result.id).toBe('task-1')
      expect(result.number).toBe(42)
    })

    test('includes optional fields in request', async () => {
      let requestBody: unknown
      const mockFetch = mock((_url: string, options: RequestInit) => {
        requestBody = typeof options.body === 'string' ? JSON.parse(options.body) : undefined
        return Promise.resolve(
          new Response(
            JSON.stringify({
              id: 'task-1',
              title: 'Test',
              number: 1,
              status: 'todo',
              priority: 'high',
              description: 'Description',
              createdAt: '2026-03-01T00:00:00Z',
              dueDate: '2026-03-15',
              projectId: 'proj-1',
              userId: 'user-1',
            }),
            { status: 200 },
          ),
        )
      })
      setMockFetch(mockFetch)

      const resource = new TaskResource(mockConfig)
      await resource.create({
        projectId: 'proj-1',
        title: 'Test',
        description: 'Description',
        priority: 'high',
        dueDate: '2026-03-15',
        status: 'in-progress',
      })

      expect(requestBody).toMatchObject({
        title: 'Test',
        description: 'Description',
        priority: 'high',
        dueDate: '2026-03-15',
        status: 'in-progress',
      })
    })

    test('applies default priority when not provided', async () => {
      let requestBody: unknown
      const mockFetch = mock((_url: string, options: RequestInit) => {
        requestBody = typeof options.body === 'string' ? JSON.parse(options.body) : undefined
        return Promise.resolve(
          new Response(
            JSON.stringify({
              id: 'task-1',
              title: 'Test',
              number: 1,
              status: 'todo',
              priority: 'no-priority',
              description: '',
              createdAt: '2026-03-01T00:00:00Z',
              dueDate: null,
              projectId: 'proj-1',
              userId: null,
            }),
            { status: 200 },
          ),
        )
      })
      setMockFetch(mockFetch)

      const resource = new TaskResource(mockConfig)
      await resource.create({
        projectId: 'proj-1',
        title: 'Test',
      })

      expect(requestBody).toMatchObject({ priority: 'no-priority' })
    })

    test('applies default status when not provided', async () => {
      let requestBody: unknown
      const mockFetch = mock((_url: string, options: RequestInit) => {
        requestBody = typeof options.body === 'string' ? JSON.parse(options.body) : undefined
        return Promise.resolve(
          new Response(
            JSON.stringify({
              id: 'task-1',
              title: 'Test',
              number: 1,
              status: 'todo',
              priority: 'no-priority',
              description: '',
              createdAt: '2026-03-01T00:00:00Z',
              dueDate: null,
              projectId: 'proj-1',
              userId: null,
            }),
            { status: 200 },
          ),
        )
      })
      setMockFetch(mockFetch)

      const resource = new TaskResource(mockConfig)
      await resource.create({
        projectId: 'proj-1',
        title: 'Test',
      })

      expect(requestBody).toMatchObject({ status: 'todo' })
    })

    test('accepts priority low', async () => {
      const mockFetch = mock(() =>
        Promise.resolve(
          new Response(
            JSON.stringify({
              id: 'task-1',
              title: 'Test',
              number: 1,
              status: 'todo',
              priority: 'low',
              description: '',
              createdAt: '2026-03-01T00:00:00Z',
              dueDate: null,
              projectId: 'proj-1',
              userId: null,
            }),
            { status: 200 },
          ),
        ),
      )
      setMockFetch(mockFetch)

      const resource = new TaskResource(mockConfig)
      const result = await resource.create({
        projectId: 'proj-1',
        title: 'Test',
        priority: 'low',
      })

      expect(result.priority).toBe('low')
    })

    test('accepts priority high', async () => {
      const mockFetch = mock(() =>
        Promise.resolve(
          new Response(
            JSON.stringify({
              id: 'task-1',
              title: 'Test',
              number: 1,
              status: 'todo',
              priority: 'high',
              description: '',
              createdAt: '2026-03-01T00:00:00Z',
              dueDate: null,
              projectId: 'proj-1',
              userId: null,
            }),
            { status: 200 },
          ),
        ),
      )
      setMockFetch(mockFetch)

      const resource = new TaskResource(mockConfig)
      const result = await resource.create({
        projectId: 'proj-1',
        title: 'Test',
        priority: 'high',
      })

      expect(result.priority).toBe('high')
    })

    test('accepts priority urgent', async () => {
      const mockFetch = mock(() =>
        Promise.resolve(
          new Response(
            JSON.stringify({
              id: 'task-1',
              title: 'Test',
              number: 1,
              status: 'todo',
              priority: 'urgent',
              description: '',
              createdAt: '2026-03-01T00:00:00Z',
              dueDate: null,
              projectId: 'proj-1',
              userId: null,
            }),
            { status: 200 },
          ),
        ),
      )
      setMockFetch(mockFetch)

      const resource = new TaskResource(mockConfig)
      const result = await resource.create({
        projectId: 'proj-1',
        title: 'Test',
        priority: 'urgent',
      })

      expect(result.priority).toBe('urgent')
    })
  })

  describe('get', () => {
    test('fetches task with details', async () => {
      const mockFetch = mock(() =>
        Promise.resolve(
          new Response(
            JSON.stringify({
              id: 'task-1',
              title: 'Test',
              number: 1,
              status: 'todo',
              priority: 'medium',
              description: 'Details',
              dueDate: null,
              createdAt: '2026-03-01T00:00:00Z',
              projectId: 'proj-1',
              userId: null,
            }),
            { status: 200 },
          ),
        ),
      )
      setMockFetch(mockFetch)

      const resource = new TaskResource(mockConfig)
      const result = await resource.get('task-1')
      expect(result.id).toBe('task-1')
      expect(result.description).toBe('Details')
    })

    test('parses relations from description frontmatter', async () => {
      const mockFetch = mock(() =>
        Promise.resolve(
          new Response(
            JSON.stringify({
              id: 'task-1',
              title: 'Test',
              number: 1,
              status: 'todo',
              priority: 'medium',
              description: '---\nblocks: task-2\nrelated: task-3\n---\nTask details',
              dueDate: null,
              createdAt: '2026-03-01T00:00:00Z',
              projectId: 'proj-1',
              userId: null,
            }),
            { status: 200 },
          ),
        ),
      )
      setMockFetch(mockFetch)

      const resource = new TaskResource(mockConfig)
      const result = await resource.get('task-1')
      expect(result.relations).toHaveLength(2)
      expect(result.relations[0]!.type).toBe('blocks')
      expect(result.relations[0]!.taskId).toBe('task-2')
    })

    test('handles task with empty description', async () => {
      const mockFetch = mock(() =>
        Promise.resolve(
          new Response(
            JSON.stringify({
              id: 'task-1',
              title: 'Test',
              number: 1,
              status: 'todo',
              priority: 'medium',
              description: '',
              dueDate: null,
              createdAt: '2026-03-01T00:00:00Z',
              projectId: 'proj-1',
              userId: null,
            }),
            { status: 200 },
          ),
        ),
      )
      setMockFetch(mockFetch)

      const resource = new TaskResource(mockConfig)
      const result = await resource.get('task-1')
      expect(result.relations).toEqual([])
    })
  })

  describe('update', () => {
    describe('single field updates', () => {
      test('uses status endpoint for status update', async () => {
        let requestUrl = ''
        const mockFetch = mock((url: string, _options: RequestInit) => {
          requestUrl = url
          return Promise.resolve(
            new Response(
              JSON.stringify({
                id: 'task-1',
                title: 'Test',
                number: 1,
                status: 'done',
                priority: 'medium',
                description: '',
                createdAt: '2026-03-01T00:00:00Z',
                dueDate: null,
                projectId: 'proj-1',
                userId: null,
              }),
              { status: 200 },
            ),
          )
        })
        setMockFetch(mockFetch)

        const resource = new TaskResource(mockConfig)
        await resource.update('task-1', { status: 'done' })

        expect(requestUrl).toContain('/task/status/task-1')
      })

      test('uses priority endpoint for priority update', async () => {
        let requestUrl = ''
        const mockFetch = mock((url: string, _options: RequestInit) => {
          requestUrl = url
          return Promise.resolve(
            new Response(
              JSON.stringify({
                id: 'task-1',
                title: 'Test',
                number: 1,
                status: 'todo',
                priority: 'high',
                description: '',
                createdAt: '2026-03-01T00:00:00Z',
                dueDate: null,
                projectId: 'proj-1',
                userId: null,
              }),
              { status: 200 },
            ),
          )
        })
        setMockFetch(mockFetch)

        const resource = new TaskResource(mockConfig)
        await resource.update('task-1', { priority: 'high' })

        expect(requestUrl).toContain('/task/priority/task-1')
      })

      test('uses assign endpoint for userId update', async () => {
        let requestUrl = ''
        const mockFetch = mock((url: string, _options: RequestInit) => {
          requestUrl = url
          return Promise.resolve(
            new Response(
              JSON.stringify({
                id: 'task-1',
                title: 'Test',
                number: 1,
                status: 'todo',
                priority: 'medium',
                description: '',
                createdAt: '2026-03-01T00:00:00Z',
                dueDate: null,
                projectId: 'proj-1',
                userId: 'user-123',
              }),
              { status: 200 },
            ),
          )
        })
        setMockFetch(mockFetch)

        const resource = new TaskResource(mockConfig)
        await resource.update('task-1', { userId: 'user-123' })

        expect(requestUrl).toContain('/task/assignee/task-1')
      })

      test('uses dueDate endpoint for dueDate update', async () => {
        let requestUrl = ''
        const mockFetch = mock((url: string, _options: RequestInit) => {
          requestUrl = url
          return Promise.resolve(
            new Response(
              JSON.stringify({
                id: 'task-1',
                title: 'Test',
                number: 1,
                status: 'todo',
                priority: 'medium',
                description: '',
                createdAt: '2026-03-01T00:00:00Z',
                dueDate: '2026-12-31',
                projectId: 'proj-1',
                userId: null,
              }),
              { status: 200 },
            ),
          )
        })
        setMockFetch(mockFetch)

        const resource = new TaskResource(mockConfig)
        await resource.update('task-1', { dueDate: '2026-12-31' })

        expect(requestUrl).toContain('/task/due-date/task-1')
      })

      test('uses title endpoint for title update', async () => {
        let requestUrl = ''
        const mockFetch = mock((url: string, _options: RequestInit) => {
          requestUrl = url
          return Promise.resolve(
            new Response(
              JSON.stringify({
                id: 'task-1',
                title: 'Updated Title',
                number: 1,
                status: 'todo',
                priority: 'medium',
                description: '',
                createdAt: '2026-03-01T00:00:00Z',
                dueDate: null,
                projectId: 'proj-1',
                userId: null,
              }),
              { status: 200 },
            ),
          )
        })
        setMockFetch(mockFetch)

        const resource = new TaskResource(mockConfig)
        await resource.update('task-1', { title: 'Updated Title' })

        expect(requestUrl).toContain('/task/title/task-1')
      })

      test('uses description endpoint for description update', async () => {
        let requestUrl = ''
        const mockFetch = mock((url: string, _options: RequestInit) => {
          requestUrl = url
          return Promise.resolve(
            new Response(
              JSON.stringify({
                id: 'task-1',
                title: 'Test',
                number: 1,
                status: 'todo',
                priority: 'medium',
                description: 'Updated description',
                createdAt: '2026-03-01T00:00:00Z',
                dueDate: null,
                projectId: 'proj-1',
                userId: null,
              }),
              { status: 200 },
            ),
          )
        })
        setMockFetch(mockFetch)

        const resource = new TaskResource(mockConfig)
        await resource.update('task-1', { description: 'Updated description' })

        expect(requestUrl).toContain('/task/description/task-1')
      })
    })

    describe('multi-field updates', () => {
      test('fetches position before multi-field update', async () => {
        let requestCount = 0
        const mockFetch = mock((url: string, options: RequestInit) => {
          requestCount++
          if (url.includes('/task/task-1') && options.method === 'GET') {
            return Promise.resolve(
              new Response(
                JSON.stringify({
                  id: 'task-1',
                  title: 'Old',
                  number: 1,
                  status: 'todo',
                  priority: 'medium',
                  description: 'Old desc',
                  createdAt: '2026-03-01T00:00:00Z',
                  dueDate: null,
                  projectId: 'proj-1',
                  position: 42,
                  userId: null,
                }),
                { status: 200 },
              ),
            )
          }
          return Promise.resolve(
            new Response(
              JSON.stringify({
                id: 'task-1',
                title: 'New Title',
                number: 1,
                status: 'done',
                priority: 'high',
                description: 'New desc',
                dueDate: null,
                projectId: 'proj-1',
              }),
              { status: 200 },
            ),
          )
        })
        setMockFetch(mockFetch)

        const resource = new TaskResource(mockConfig)
        await resource.update('task-1', {
          title: 'New Title',
          status: 'done',
          priority: 'high',
          description: 'New desc',
        })

        expect(requestCount).toBe(2)
      })

      test('uses PUT /task/task-1 for multi-field update', async () => {
        let requestUrl = ''
        let requestBody: unknown

        const mockFetch = mock((url: string, options: RequestInit) => {
          if (url.includes('/task/task-1') && options.method === 'GET') {
            return Promise.resolve(
              new Response(
                JSON.stringify({
                  id: 'task-1',
                  title: 'Old',
                  number: 1,
                  status: 'todo',
                  priority: 'medium',
                  description: 'Old',
                  createdAt: '2026-03-01T00:00:00Z',
                  dueDate: null,
                  projectId: 'proj-1',
                  position: 0,
                  userId: null,
                }),
                { status: 200 },
              ),
            )
          }
          requestUrl = url
          requestBody = typeof options.body === 'string' ? JSON.parse(options.body) : undefined
          return Promise.resolve(
            new Response(
              JSON.stringify({
                id: 'task-1',
                title: 'New',
                number: 1,
                status: 'done',
                priority: 'high',
                description: 'New',
                dueDate: null,
                projectId: 'proj-1',
              }),
              { status: 200 },
            ),
          )
        })
        setMockFetch(mockFetch)

        const resource = new TaskResource(mockConfig)
        await resource.update('task-1', {
          title: 'New',
          status: 'done',
        })

        expect(requestUrl).toContain('/task/task-1')
        expect(requestBody).toMatchObject({
          title: 'New',
          status: 'done',
          position: 0,
        })
      })
    })
  })

  describe('delete', () => {
    test('deletes task successfully', async () => {
      const mockFetch = mock(() => Promise.resolve(new Response('{}', { status: 200 })))
      setMockFetch(mockFetch)

      const resource = new TaskResource(mockConfig)
      const result = await resource.delete('task-1')
      expect(result.id).toBe('task-1')
      expect(result.success).toBe(true)
    })
  })

  describe('list', () => {
    test('lists tasks for project', async () => {
      const mockFetch = mock(() =>
        Promise.resolve(
          new Response(
            JSON.stringify([
              {
                id: 'task-1',
                title: 'Task 1',
                number: 1,
                status: 'todo',
                priority: 'medium',
                dueDate: null,
              },
              {
                id: 'task-2',
                title: 'Task 2',
                number: 2,
                status: 'done',
                priority: 'high',
                dueDate: '2026-12-31',
              },
            ]),
            { status: 200 },
          ),
        ),
      )
      setMockFetch(mockFetch)

      const resource = new TaskResource(mockConfig)
      const result = await resource.list('proj-1')
      expect(result).toHaveLength(2)
      expect(result[0]!.title).toBe('Task 1')
    })

    test('returns empty array when no tasks', async () => {
      const mockFetch = mock(() => Promise.resolve(new Response(JSON.stringify([]), { status: 200 })))
      setMockFetch(mockFetch)

      const resource = new TaskResource(mockConfig)
      const result = await resource.list('empty-proj')
      expect(result).toHaveLength(0)
    })
  })

  describe('search', () => {
    test('searches tasks by keyword', async () => {
      const mockFetch = mock(() =>
        Promise.resolve(
          new Response(
            JSON.stringify({
              tasks: [
                {
                  id: 'task-1',
                  title: 'Fix bug',
                  number: 1,
                  status: 'todo',
                  priority: 'high',
                },
                {
                  id: 'task-2',
                  title: 'Bug report',
                  number: 2,
                  status: 'done',
                  priority: 'medium',
                },
              ],
            }),
            { status: 200 },
          ),
        ),
      )
      setMockFetch(mockFetch)

      const resource = new TaskResource(mockConfig)
      const result = await resource.search({
        query: 'bug',
        workspaceId: 'ws-1',
      })
      expect(result).toHaveLength(2)
    })

    test('filters by projectId when provided', async () => {
      let requestUrl = ''
      const mockFetch = mock((url: string) => {
        requestUrl = url
        return Promise.resolve(new Response(JSON.stringify({ tasks: [] }), { status: 200 }))
      })
      setMockFetch(mockFetch)

      const resource = new TaskResource(mockConfig)
      await resource.search({
        query: 'test',
        workspaceId: 'ws-1',
        projectId: 'proj-1',
      })

      expect(requestUrl).toContain('projectId=proj-1')
    })

    test('returns empty array when no matches', async () => {
      const mockFetch = mock(() => Promise.resolve(new Response(JSON.stringify({ tasks: [] }), { status: 200 })))
      setMockFetch(mockFetch)

      const resource = new TaskResource(mockConfig)
      const result = await resource.search({
        query: 'nonexistent',
        workspaceId: 'ws-1',
      })
      expect(result).toEqual([])
    })
  })
})
