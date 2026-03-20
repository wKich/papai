import { afterEach, beforeEach, describe, expect, mock, test } from 'bun:test'

import type { KaneoConfig } from '../../../src/providers/kaneo/client.js'
import { restoreFetch, setMockFetch, createMockTask, createMockColumn } from '../../test-helpers.js'
import { TaskResource } from './test-resources.js'

void mock.module('../../../src/providers/kaneo/list-columns.js', () => ({
  listColumns: mock(() =>
    Promise.resolve([
      createMockColumn({ id: 'col-1', name: 'To Do' }),
      createMockColumn({ id: 'col-2', name: 'In Progress' }),
      createMockColumn({ id: 'col-3', name: 'Done', isFinal: true }),
    ]),
  ),
}))

describe('TaskResource', () => {
  const mockConfig: KaneoConfig = {
    apiKey: 'test-key',
    baseUrl: 'https://api.test.com',
  }

  beforeEach(() => {
    mock.restore()
  })

  afterEach(() => {
    restoreFetch()
  })

  describe('create', () => {
    test('creates task with required fields', async () => {
      setMockFetch(() =>
        Promise.resolve(
          new Response(
            JSON.stringify(
              createMockTask({
                id: 'task-1',
                title: 'Test Task',
                number: 42,
                priority: 'no-priority',
                description: '',
              }),
            ),
            { status: 200 },
          ),
        ),
      )

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
      setMockFetch((_url: string, options: RequestInit) => {
        requestBody = typeof options.body === 'string' ? JSON.parse(options.body) : undefined
        return Promise.resolve(
          new Response(
            JSON.stringify(
              createMockTask({
                id: 'task-1',
                title: 'Test',
                number: 1,
                priority: 'high',
                description: 'Description',
                dueDate: '2026-03-15',
                userId: 'user-1',
              }),
            ),
            { status: 200 },
          ),
        )
      })

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
      setMockFetch((_url: string, options: RequestInit) => {
        requestBody = typeof options.body === 'string' ? JSON.parse(options.body) : undefined
        return Promise.resolve(
          new Response(
            JSON.stringify(
              createMockTask({
                id: 'task-1',
                title: 'Test',
                number: 1,
                priority: 'no-priority',
                description: '',
              }),
            ),
            { status: 200 },
          ),
        )
      })

      const resource = new TaskResource(mockConfig)
      await resource.create({
        projectId: 'proj-1',
        title: 'Test',
      })

      expect(requestBody).toMatchObject({ priority: 'no-priority' })
    })

    test('applies default status when not provided', async () => {
      let requestBody: unknown
      setMockFetch((_url: string, options: RequestInit) => {
        requestBody = typeof options.body === 'string' ? JSON.parse(options.body) : undefined
        return Promise.resolve(
          new Response(
            JSON.stringify(
              createMockTask({
                id: 'task-1',
                title: 'Test',
                number: 1,
                priority: 'no-priority',
                description: '',
              }),
            ),
            { status: 200 },
          ),
        )
      })

      const resource = new TaskResource(mockConfig)
      await resource.create({
        projectId: 'proj-1',
        title: 'Test',
      })

      expect(requestBody).toMatchObject({ status: 'to-do' })
    })

    test('accepts priority low', async () => {
      setMockFetch(() =>
        Promise.resolve(
          new Response(
            JSON.stringify(
              createMockTask({
                id: 'task-1',
                title: 'Test',
                number: 1,
                priority: 'low',
                description: '',
              }),
            ),
            { status: 200 },
          ),
        ),
      )

      const resource = new TaskResource(mockConfig)
      const result = await resource.create({
        projectId: 'proj-1',
        title: 'Test',
        priority: 'low',
      })

      expect(result.priority).toBe('low')
    })

    test('accepts priority high', async () => {
      setMockFetch(() =>
        Promise.resolve(
          new Response(
            JSON.stringify(
              createMockTask({
                id: 'task-1',
                title: 'Test',
                number: 1,
                priority: 'high',
                description: '',
              }),
            ),
            { status: 200 },
          ),
        ),
      )

      const resource = new TaskResource(mockConfig)
      const result = await resource.create({
        projectId: 'proj-1',
        title: 'Test',
        priority: 'high',
      })

      expect(result.priority).toBe('high')
    })

    test('accepts priority urgent', async () => {
      setMockFetch(() =>
        Promise.resolve(
          new Response(
            JSON.stringify(
              createMockTask({
                id: 'task-1',
                title: 'Test',
                number: 1,
                priority: 'urgent',
                description: '',
              }),
            ),
            { status: 200 },
          ),
        ),
      )

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
      setMockFetch(() =>
        Promise.resolve(
          new Response(
            JSON.stringify(
              createMockTask({
                id: 'task-1',
                title: 'Test',
                number: 1,
                description: 'Details',
              }),
            ),
            { status: 200 },
          ),
        ),
      )

      const resource = new TaskResource(mockConfig)
      const result = await resource.get('task-1')
      expect(result.id).toBe('task-1')
      expect(result.description).toBe('Details')
    })

    test('parses relations from description frontmatter', async () => {
      setMockFetch(() =>
        Promise.resolve(
          new Response(
            JSON.stringify(
              createMockTask({
                id: 'task-1',
                title: 'Test',
                number: 1,
                description: '---\nblocks: task-2\nrelated: task-3\n---\nTask details',
              }),
            ),
            { status: 200 },
          ),
        ),
      )

      const resource = new TaskResource(mockConfig)
      const result = await resource.get('task-1')
      expect(result.relations).toHaveLength(2)
      expect(result.relations[0]!.type).toBe('blocks')
      expect(result.relations[0]!.taskId).toBe('task-2')
    })

    test('handles task with empty description', async () => {
      setMockFetch(() =>
        Promise.resolve(
          new Response(
            JSON.stringify(
              createMockTask({
                id: 'task-1',
                title: 'Test',
                number: 1,
                description: '',
              }),
            ),
            { status: 200 },
          ),
        ),
      )

      const resource = new TaskResource(mockConfig)
      const result = await resource.get('task-1')
      expect(result.relations).toEqual([])
    })
  })

  describe('update', () => {
    describe('single field updates', () => {
      test('uses status endpoint for status update', async () => {
        let requestUrl = ''
        setMockFetch((url: string, _options: RequestInit) => {
          requestUrl = url
          return Promise.resolve(
            new Response(
              JSON.stringify(
                createMockTask({
                  id: 'task-1',
                  title: 'Test',
                  number: 1,
                  status: 'done',
                  description: '',
                }),
              ),
              { status: 200 },
            ),
          )
        })

        const resource = new TaskResource(mockConfig)
        await resource.update('task-1', { status: 'done' })

        expect(requestUrl).toContain('/task/status/task-1')
      })

      test('uses priority endpoint for priority update', async () => {
        let requestUrl = ''
        setMockFetch((url: string, _options: RequestInit) => {
          requestUrl = url
          return Promise.resolve(
            new Response(
              JSON.stringify(
                createMockTask({
                  id: 'task-1',
                  title: 'Test',
                  number: 1,
                  priority: 'high',
                  description: '',
                }),
              ),
              { status: 200 },
            ),
          )
        })

        const resource = new TaskResource(mockConfig)
        await resource.update('task-1', { priority: 'high' })

        expect(requestUrl).toContain('/task/priority/task-1')
      })

      test('uses assign endpoint for userId update', async () => {
        let requestUrl = ''
        setMockFetch((url: string, _options: RequestInit) => {
          requestUrl = url
          return Promise.resolve(
            new Response(
              JSON.stringify(
                createMockTask({
                  id: 'task-1',
                  title: 'Test',
                  number: 1,
                  description: '',
                  userId: 'user-123',
                }),
              ),
              { status: 200 },
            ),
          )
        })

        const resource = new TaskResource(mockConfig)
        await resource.update('task-1', { userId: 'user-123' })

        expect(requestUrl).toContain('/task/assignee/task-1')
      })

      test('uses dueDate endpoint for dueDate update', async () => {
        let requestUrl = ''
        setMockFetch((url: string, _options: RequestInit) => {
          requestUrl = url
          return Promise.resolve(
            new Response(
              JSON.stringify(
                createMockTask({
                  id: 'task-1',
                  title: 'Test',
                  number: 1,
                  description: '',
                  dueDate: '2026-12-31',
                }),
              ),
              { status: 200 },
            ),
          )
        })

        const resource = new TaskResource(mockConfig)
        await resource.update('task-1', { dueDate: '2026-12-31' })

        expect(requestUrl).toContain('/task/due-date/task-1')
      })

      test('uses title endpoint for title update', async () => {
        let requestUrl = ''
        setMockFetch((url: string, _options: RequestInit) => {
          requestUrl = url
          return Promise.resolve(
            new Response(
              JSON.stringify(
                createMockTask({
                  id: 'task-1',
                  title: 'Updated Title',
                  number: 1,
                  description: '',
                }),
              ),
              { status: 200 },
            ),
          )
        })

        const resource = new TaskResource(mockConfig)
        await resource.update('task-1', { title: 'Updated Title' })

        expect(requestUrl).toContain('/task/title/task-1')
      })

      test('uses description endpoint for description update', async () => {
        let requestUrl = ''
        setMockFetch((url: string, _options: RequestInit) => {
          requestUrl = url
          return Promise.resolve(
            new Response(
              JSON.stringify(
                createMockTask({
                  id: 'task-1',
                  title: 'Test',
                  number: 1,
                  description: 'Updated description',
                }),
              ),
              { status: 200 },
            ),
          )
        })

        const resource = new TaskResource(mockConfig)
        await resource.update('task-1', { description: 'Updated description' })

        expect(requestUrl).toContain('/task/description/task-1')
      })
    })

    describe('multi-field updates', () => {
      test('calls single-field endpoints for each field', async () => {
        const requests: Array<{ url: string; method: string; body?: unknown }> = []

        setMockFetch((url: string, options: RequestInit) => {
          const parsedBody: unknown = typeof options.body === 'string' ? JSON.parse(options.body) : undefined
          requests.push({ url, method: options.method ?? 'GET', body: parsedBody })

          // Return success for any single-field endpoint
          return Promise.resolve(
            new Response(
              JSON.stringify(
                createMockTask({
                  id: 'task-1',
                  title: 'New Title',
                  number: 1,
                  status: 'done',
                  priority: 'high',
                  description: 'New desc',
                }),
              ),
              { status: 200 },
            ),
          )
        })

        const resource = new TaskResource(mockConfig)
        await resource.update('task-1', {
          title: 'New Title',
          status: 'done',
          priority: 'high',
          description: 'New desc',
        })

        // Should make 5 requests - one GET for validation + one for each field
        expect(requests.length).toBe(5)
        // GET request for projectId lookup
        expect(requests[0]?.url).toContain('/task/task-1')
        expect(requests[1]?.url).toContain('/task/title/task-1')
        expect(requests[2]?.url).toContain('/task/status/task-1')
        expect(requests[3]?.url).toContain('/task/priority/task-1')
        expect(requests[4]?.url).toContain('/task/description/task-1')
      })

      test('uses correct endpoints for each field type', async () => {
        const requests: Array<{ url: string; body?: unknown }> = []

        setMockFetch((url: string, options: RequestInit) => {
          const parsedBody: unknown = typeof options.body === 'string' ? JSON.parse(options.body) : undefined
          requests.push({ url, body: parsedBody })

          return Promise.resolve(
            new Response(
              JSON.stringify(
                createMockTask({
                  id: 'task-1',
                  title: 'New',
                  number: 1,
                  status: 'done',
                  priority: 'high',
                  description: 'New',
                }),
              ),
              { status: 200 },
            ),
          )
        })

        const resource = new TaskResource(mockConfig)
        await resource.update('task-1', {
          title: 'New',
          status: 'done',
        })

        expect(requests.length).toBe(3)
        // GET request for projectId lookup
        expect(requests[0]?.url).toContain('/task/task-1')
        expect(requests[1]?.url).toContain('/task/title/task-1')
        expect(requests[1]?.body).toMatchObject({ title: 'New' })
        expect(requests[2]?.url).toContain('/task/status/task-1')
        expect(requests[2]?.body).toMatchObject({ status: 'done' })
      })
    })
  })

  describe('delete', () => {
    test('deletes task successfully', async () => {
      setMockFetch(() => Promise.resolve(new Response('{}', { status: 200 })))

      const resource = new TaskResource(mockConfig)
      const result = await resource.delete('task-1')
      expect(result.id).toBe('task-1')
      expect(result.success).toBe(true)
    })
  })

  describe('list', () => {
    test('lists tasks for project', async () => {
      setMockFetch(() =>
        Promise.resolve(
          new Response(
            JSON.stringify({
              id: 'proj-1',
              name: 'Project 1',
              columns: [
                {
                  id: 'col-1',
                  name: 'Todo',
                  icon: null,
                  color: null,
                  isFinal: false,
                  tasks: [
                    { id: 'task-1', title: 'Task 1', number: 1, status: 'todo', priority: 'medium', dueDate: null },
                    {
                      id: 'task-2',
                      title: 'Task 2',
                      number: 2,
                      status: 'done',
                      priority: 'high',
                      dueDate: '2026-12-31',
                    },
                  ],
                },
              ],
              archivedTasks: [],
              plannedTasks: [],
            }),
            { status: 200 },
          ),
        ),
      )

      const resource = new TaskResource(mockConfig)
      const result = await resource.list('proj-1')
      expect(result).toHaveLength(2)
      expect(result[0]!.title).toBe('Task 1')
    })

    test('returns empty array when no tasks', async () => {
      setMockFetch(() =>
        Promise.resolve(
          new Response(
            JSON.stringify({
              id: 'empty-proj',
              name: 'Empty Project',
              columns: [],
              archivedTasks: [],
              plannedTasks: [],
            }),
            { status: 200 },
          ),
        ),
      )

      const resource = new TaskResource(mockConfig)
      const result = await resource.list('empty-proj')
      expect(result).toHaveLength(0)
    })
  })

  describe('search', () => {
    test('searches tasks by keyword', async () => {
      // API returns flat { results, totalCount, searchQuery } — not per-type arrays.
      // See: https://github.com/usekaneo/kaneo/blob/main/apps/api/src/search/controllers/global-search.ts
      setMockFetch(() =>
        Promise.resolve(
          new Response(
            JSON.stringify({
              results: [
                {
                  id: 'task-1',
                  type: 'task',
                  title: 'Fix bug',
                  description: null,
                  projectId: 'proj-1',
                  taskNumber: 1,
                  status: 'todo',
                  priority: 'high',
                  relevanceScore: 3,
                  createdAt: '2026-01-01T00:00:00Z',
                },
                {
                  id: 'task-2',
                  type: 'task',
                  title: 'Bug report',
                  description: null,
                  projectId: 'proj-1',
                  taskNumber: 2,
                  status: 'done',
                  priority: 'medium',
                  relevanceScore: 2,
                  createdAt: '2026-01-02T00:00:00Z',
                },
              ],
              totalCount: 2,
              searchQuery: 'bug',
            }),
            { status: 200 },
          ),
        ),
      )

      const resource = new TaskResource(mockConfig)
      const result = await resource.search({
        query: 'bug',
        workspaceId: 'ws-1',
      })
      expect(result).toHaveLength(2)
    })

    test('filters by projectId when provided', async () => {
      let requestUrl = ''
      setMockFetch((url: string) => {
        requestUrl = url
        return Promise.resolve(
          new Response(JSON.stringify({ results: [], totalCount: 0, searchQuery: 'test' }), { status: 200 }),
        )
      })

      const resource = new TaskResource(mockConfig)
      await resource.search({
        query: 'test',
        workspaceId: 'ws-1',
        projectId: 'proj-1',
      })

      expect(requestUrl).toContain('projectId=proj-1')
    })

    test('returns empty array when no matches', async () => {
      setMockFetch(() =>
        Promise.resolve(
          new Response(JSON.stringify({ results: [], totalCount: 0, searchQuery: 'nonexistent' }), { status: 200 }),
        ),
      )

      const resource = new TaskResource(mockConfig)
      const result = await resource.search({
        query: 'nonexistent',
        workspaceId: 'ws-1',
      })
      expect(result).toEqual([])
    })
  })

  describe('archive', () => {
    test('archives task by adding archive label', async () => {
      setMockFetch(() =>
        Promise.resolve(
          new Response(JSON.stringify([{ id: 'label-1', name: 'archived', color: '#808080', workspaceId: 'ws-1' }]), {
            status: 200,
          }),
        ),
      )

      const resource = new TaskResource(mockConfig)
      const result = await resource.archive('task-1', 'ws-1')

      expect(result.id).toBe('task-1')
      expect(result.archivedAt).toBeDefined()
    })

    test('creates archive label if not exists', async () => {
      setMockFetch((url: string) => {
        // List workspace labels (empty)
        if (url.includes('/label/workspace/ws-1')) {
          return Promise.resolve(new Response(JSON.stringify([]), { status: 200 }))
        }
        // Create label (POST to /label endpoint)
        if (url.endsWith('/label') && !url.includes('/workspace/') && !url.includes('/task/')) {
          return Promise.resolve(
            new Response(JSON.stringify({ id: 'label-new', name: 'archived', color: '#808080', workspaceId: 'ws-1' }), {
              status: 200,
            }),
          )
        }
        // Get label by ID
        if (url.match(/\/label\/[^/]+$/)) {
          return Promise.resolve(
            new Response(JSON.stringify({ id: 'label-new', name: 'archived', color: '#808080', workspaceId: 'ws-1' }), {
              status: 200,
            }),
          )
        }
        // Get task labels (isTaskArchived check)
        if (url.includes('/label/task/')) {
          return Promise.resolve(new Response(JSON.stringify([]), { status: 200 }))
        }
        // Add label to task (POST to /label/workspace/{labelId}/task/{taskId})
        if (url.includes('/label/workspace/') && url.includes('/task/')) {
          return Promise.resolve(new Response('{}', { status: 200 }))
        }
        return Promise.resolve(new Response('{}', { status: 200 }))
      })

      const resource = new TaskResource(mockConfig)
      const result = await resource.archive('task-1', 'ws-1')

      expect(result.id).toBe('task-1')
    })

    test('skips adding label if already archived', async () => {
      let callCount = 0
      setMockFetch(() => {
        callCount++
        // First call: list labels returns archive label
        if (callCount === 1) {
          return Promise.resolve(
            new Response(JSON.stringify([{ id: 'label-1', name: 'archived', color: '#808080', workspaceId: 'ws-1' }]), {
              status: 200,
            }),
          )
        }
        // Second call: check if task has label (returns label)
        if (callCount === 2) {
          return Promise.resolve(
            new Response(JSON.stringify([{ id: 'label-1', name: 'archived', color: '#808080', workspaceId: 'ws-1' }]), {
              status: 200,
            }),
          )
        }
        return Promise.resolve(new Response('{}', { status: 200 }))
      })

      const resource = new TaskResource(mockConfig)
      const result = await resource.archive('task-1', 'ws-1')

      expect(result.id).toBe('task-1')
      expect(callCount).toBe(2)
    })
  })

  describe('addRelation', () => {
    test('adds relation between tasks', async () => {
      let callCount = 0
      setMockFetch(() => {
        callCount++
        // First call: get related task
        if (callCount === 1) {
          return Promise.resolve(
            new Response(
              JSON.stringify({
                id: 'task-2',
                title: 'Related Task',
                description: '',
                number: 2,
                status: 'todo',
                priority: 'medium',
                projectId: 'proj-1',
                position: 0,
                userId: null,
                createdAt: new Date().toISOString(),
              }),
              { status: 200 },
            ),
          )
        }
        // Second call: get source task
        if (callCount === 2) {
          return Promise.resolve(
            new Response(
              JSON.stringify({
                id: 'task-1',
                title: 'Task 1',
                description: '',
                number: 1,
                status: 'todo',
                priority: 'medium',
                projectId: 'proj-1',
                position: 0,
                userId: null,
                createdAt: new Date().toISOString(),
              }),
              { status: 200 },
            ),
          )
        }
        // Third call: update description with relation
        return Promise.resolve(
          new Response(
            JSON.stringify({
              id: 'task-1',
              title: 'Task 1',
              description: '---\nblocks: task-2\n---',
              number: 1,
              status: 'todo',
              priority: 'medium',
              projectId: 'proj-1',
              position: 0,
              userId: null,
              createdAt: new Date().toISOString(),
            }),
            { status: 200 },
          ),
        )
      })

      const resource = new TaskResource(mockConfig)
      const result = await resource.addRelation('task-1', 'task-2', 'blocks')

      expect(result.taskId).toBe('task-1')
      expect(result.relatedTaskId).toBe('task-2')
      expect(result.type).toBe('blocks')
    })
  })

  describe('removeRelation', () => {
    test('removes relation between tasks', async () => {
      let callCount = 0
      setMockFetch(() => {
        callCount++
        // First call: get task with relation
        if (callCount === 1) {
          return Promise.resolve(
            new Response(
              JSON.stringify({
                id: 'task-1',
                title: 'Task 1',
                description: '---\nblocks: task-2\n---',
                number: 1,
                status: 'todo',
                priority: 'medium',
                projectId: 'proj-1',
                position: 0,
                userId: null,
                createdAt: new Date().toISOString(),
              }),
              { status: 200 },
            ),
          )
        }
        // Second call: update description without relation
        return Promise.resolve(
          new Response(
            JSON.stringify({
              id: 'task-1',
              title: 'Task 1',
              description: '',
              number: 1,
              status: 'todo',
              priority: 'medium',
              projectId: 'proj-1',
              position: 0,
              userId: null,
              createdAt: new Date().toISOString(),
            }),
            { status: 200 },
          ),
        )
      })

      const resource = new TaskResource(mockConfig)
      const result = await resource.removeRelation('task-1', 'task-2')

      expect(result.taskId).toBe('task-1')
      expect(result.relatedTaskId).toBe('task-2')
      expect(result.success).toBe(true)
    })

    test('throws error when relation not found', async () => {
      setMockFetch(() =>
        Promise.resolve(
          new Response(
            JSON.stringify({
              id: 'task-1',
              title: 'Task 1',
              description: '',
              number: 1,
              status: 'todo',
              priority: 'medium',
              projectId: 'proj-1',
              position: 0,
              userId: null,
              createdAt: new Date().toISOString(),
            }),
            { status: 200 },
          ),
        ),
      )

      const resource = new TaskResource(mockConfig)
      const promise = resource.removeRelation('task-1', 'task-2')
      await expect(promise).rejects.toThrow('not found')
    })
  })

  describe('updateRelation', () => {
    test('updates relation type', async () => {
      let callCount = 0
      setMockFetch(() => {
        callCount++
        // First call: get task with existing relation
        if (callCount === 1) {
          return Promise.resolve(
            new Response(
              JSON.stringify({
                id: 'task-1',
                title: 'Task 1',
                description: '---\nblocks: task-2\n---',
                number: 1,
                status: 'todo',
                priority: 'medium',
                projectId: 'proj-1',
                position: 0,
                userId: null,
                createdAt: new Date().toISOString(),
              }),
              { status: 200 },
            ),
          )
        }
        // Second call: update description with new relation type
        return Promise.resolve(
          new Response(
            JSON.stringify({
              id: 'task-1',
              title: 'Task 1',
              description: '---\nduplicate: task-2\n---',
              number: 1,
              status: 'todo',
              priority: 'medium',
              projectId: 'proj-1',
              position: 0,
              userId: null,
              createdAt: new Date().toISOString(),
            }),
            { status: 200 },
          ),
        )
      })

      const resource = new TaskResource(mockConfig)
      const result = await resource.updateRelation('task-1', 'task-2', 'duplicate')

      expect(result.taskId).toBe('task-1')
      expect(result.relatedTaskId).toBe('task-2')
      expect(result.type).toBe('duplicate')
    })

    test('throws error when relation not found', async () => {
      setMockFetch(() =>
        Promise.resolve(
          new Response(
            JSON.stringify({
              id: 'task-1',
              title: 'Task 1',
              description: '',
              number: 1,
              status: 'todo',
              priority: 'medium',
              projectId: 'proj-1',
              position: 0,
              userId: null,
              createdAt: new Date().toISOString(),
            }),
            { status: 200 },
          ),
        ),
      )

      const resource = new TaskResource(mockConfig)
      const promise = resource.updateRelation('task-1', 'task-2', 'related')
      await expect(promise).rejects.toThrow('not found')
    })
  })
})
