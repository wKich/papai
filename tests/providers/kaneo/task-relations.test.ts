import { afterEach, beforeEach, describe, expect, mock, test } from 'bun:test'

import { mockLogger } from '../../utils/test-helpers.js'

// Mock logger before importing modules that use it
mockLogger()

import type { KaneoConfig } from '../../../src/providers/kaneo/client.js'
import { createMockTask, restoreFetch, setMockFetch } from '../../test-helpers.js'
import { TaskResource } from './test-resources.js'

interface UpdateDescriptionBody {
  description: string
}

function isUpdateDescriptionBody(value: unknown): value is UpdateDescriptionBody {
  return (
    typeof value === 'object' &&
    value !== null &&
    'description' in value &&
    typeof (value as Record<string, unknown>)['description'] === 'string'
  )
}

describe('Task Relations', () => {
  const mockConfig: KaneoConfig = {
    apiKey: 'test-key',
    baseUrl: 'https://api.test.com',
  }

  const taskBase = createMockTask({
    id: 'task-1',
    title: 'Source Task',
    number: 1,
    description: '',
  })

  const relatedTaskBase = createMockTask({
    id: 'task-2',
    title: 'Related Task',
    number: 2,
    description: '',
  })

  beforeEach(() => {
    mock.restore()
  })

  afterEach(() => {
    restoreFetch()
  })

  describe('addRelation', () => {
    test('validates related task, fetches source task, then updates description', async () => {
      let callCount = 0
      let putBody: unknown

      setMockFetch((url, options) => {
        callCount++

        if (url.includes('/task/task-2') && options.method === 'GET') {
          return Promise.resolve(new Response(JSON.stringify(relatedTaskBase), { status: 200 }))
        }

        if (url.includes('/task/task-1') && options.method === 'GET') {
          return Promise.resolve(new Response(JSON.stringify({ ...taskBase, description: '' }), { status: 200 }))
        }

        if (url.includes('/task/description/task-1') && options.method === 'PUT') {
          putBody = typeof options.body === 'string' ? JSON.parse(options.body) : undefined
          return Promise.resolve(new Response(JSON.stringify(taskBase), { status: 200 }))
        }

        return Promise.resolve(new Response(JSON.stringify({}), { status: 200 }))
      })

      const resource = new TaskResource(mockConfig)
      const result = await resource.addRelation('task-1', 'task-2', 'blocks')

      expect(callCount).toBe(3)
      expect(result.taskId).toBe('task-1')
      expect(result.relatedTaskId).toBe('task-2')
      expect(result.type).toBe('blocks')
      expect(putBody).toMatchObject({ description: expect.stringContaining('task-2') as unknown })
    })

    test('adds relation with type "related"', async () => {
      let putBody: unknown

      setMockFetch((url, options) => {
        if (url.includes('/task/task-2') && options.method === 'GET') {
          return Promise.resolve(new Response(JSON.stringify(relatedTaskBase), { status: 200 }))
        }
        if (url.includes('/task/task-1') && options.method === 'GET') {
          return Promise.resolve(new Response(JSON.stringify({ ...taskBase, description: '' }), { status: 200 }))
        }
        if (url.includes('/task/description/task-1') && options.method === 'PUT') {
          putBody = typeof options.body === 'string' ? JSON.parse(options.body) : undefined
          return Promise.resolve(new Response(JSON.stringify(taskBase), { status: 200 }))
        }
        return Promise.resolve(new Response(JSON.stringify({}), { status: 200 }))
      })

      const resource = new TaskResource(mockConfig)
      const result = await resource.addRelation('task-1', 'task-2', 'related')
      expect(result.type).toBe('related')
      expect(putBody).toMatchObject({ description: expect.stringContaining('related') as unknown })
    })

    test('adds relation with type "duplicate"', async () => {
      setMockFetch((url, options) => {
        if (url.includes('/task/task-2') && options.method === 'GET') {
          return Promise.resolve(new Response(JSON.stringify(relatedTaskBase), { status: 200 }))
        }
        if (url.includes('/task/task-1') && options.method === 'GET') {
          return Promise.resolve(new Response(JSON.stringify({ ...taskBase, description: '' }), { status: 200 }))
        }
        if (url.includes('/task/description/task-1')) {
          return Promise.resolve(new Response(JSON.stringify(taskBase), { status: 200 }))
        }
        return Promise.resolve(new Response(JSON.stringify({}), { status: 200 }))
      })

      const resource = new TaskResource(mockConfig)
      const result = await resource.addRelation('task-1', 'task-2', 'duplicate')
      expect(result.type).toBe('duplicate')
    })

    test('throws when related task does not exist', async () => {
      setMockFetch(() => Promise.resolve(new Response(JSON.stringify({ error: 'Task not found' }), { status: 404 })))

      const resource = new TaskResource(mockConfig)
      const promise = resource.addRelation('task-1', 'missing-task', 'blocks')
      expect(promise).rejects.toThrow()
      await promise.catch(() => {})
    })

    test('throws when source task does not exist', async () => {
      setMockFetch((url, options) => {
        if (url.includes('/task/task-2') && options.method === 'GET') {
          return Promise.resolve(new Response(JSON.stringify(relatedTaskBase), { status: 200 }))
        }
        return Promise.resolve(new Response(JSON.stringify({ error: 'Task not found' }), { status: 404 }))
      })

      const resource = new TaskResource(mockConfig)
      const promise = resource.addRelation('missing-source', 'task-2', 'blocks')
      expect(promise).rejects.toThrow()
      await promise.catch(() => {})
    })

    test('appends relation to existing frontmatter', async () => {
      const descriptionWithExisting = '---\nrelated: task-3\n---\nExisting task'
      let putBody: unknown

      setMockFetch((url, options) => {
        if (url.includes('/task/task-2') && options.method === 'GET') {
          return Promise.resolve(new Response(JSON.stringify(relatedTaskBase), { status: 200 }))
        }
        if (url.includes('/task/task-1') && options.method === 'GET') {
          return Promise.resolve(
            new Response(JSON.stringify({ ...taskBase, description: descriptionWithExisting }), { status: 200 }),
          )
        }
        if (url.includes('/task/description/task-1') && options.method === 'PUT') {
          putBody = typeof options.body === 'string' ? JSON.parse(options.body) : undefined
          return Promise.resolve(new Response(JSON.stringify(taskBase), { status: 200 }))
        }
        return Promise.resolve(new Response(JSON.stringify({}), { status: 200 }))
      })

      const resource = new TaskResource(mockConfig)
      await resource.addRelation('task-1', 'task-2', 'blocks')

      if (!isUpdateDescriptionBody(putBody)) {
        throw new Error('putBody is not UpdateDescriptionBody')
      }
      expect(putBody.description).toContain('task-3')
      expect(putBody.description).toContain('task-2')
    })
  })

  describe('removeRelation', () => {
    test('fetches task, finds relation, removes it', async () => {
      const descriptionWithRelation = '---\nblocks: task-2\n---\nTask body'
      let putBody: unknown

      setMockFetch((url, options) => {
        if (url.includes('/task/task-1') && options.method === 'GET') {
          return Promise.resolve(
            new Response(JSON.stringify({ ...taskBase, description: descriptionWithRelation }), { status: 200 }),
          )
        }
        if (url.includes('/task/description/task-1') && options.method === 'PUT') {
          putBody = typeof options.body === 'string' ? JSON.parse(options.body) : undefined
          return Promise.resolve(new Response(JSON.stringify(taskBase), { status: 200 }))
        }
        return Promise.resolve(new Response(JSON.stringify({}), { status: 200 }))
      })

      const resource = new TaskResource(mockConfig)
      const result = await resource.removeRelation('task-1', 'task-2')

      expect(result.taskId).toBe('task-1')
      expect(result.relatedTaskId).toBe('task-2')
      expect(result.success).toBe(true)
      expect(putBody).not.toMatchObject({ description: expect.stringContaining('task-2') as unknown })
    })

    test('throws relationNotFound when relation does not exist on task', async () => {
      setMockFetch((url, options) => {
        if (url.includes('/task/task-1') && options.method === 'GET') {
          return Promise.resolve(
            new Response(JSON.stringify({ ...taskBase, description: '---\nrelated: task-3\n---' }), { status: 200 }),
          )
        }
        return Promise.resolve(new Response(JSON.stringify({}), { status: 200 }))
      })

      const resource = new TaskResource(mockConfig)
      const promise = resource.removeRelation('task-1', 'task-2')
      expect(promise).rejects.toMatchObject({ appError: { code: 'relation-not-found' } })
      await promise.catch(() => {})
    })

    test('throws when task does not exist', async () => {
      setMockFetch(() => Promise.resolve(new Response(JSON.stringify({ error: 'Task not found' }), { status: 404 })))

      const resource = new TaskResource(mockConfig)
      const promise = resource.removeRelation('missing', 'task-2')
      expect(promise).rejects.toThrow()
      await promise.catch(() => {})
    })

    test('throws when task has no relations (empty description)', async () => {
      setMockFetch((url, options) => {
        if (url.includes('/task/task-1') && options.method === 'GET') {
          return Promise.resolve(new Response(JSON.stringify({ ...taskBase, description: '' }), { status: 200 }))
        }
        return Promise.resolve(new Response(JSON.stringify({}), { status: 200 }))
      })

      const resource = new TaskResource(mockConfig)
      const promise = resource.removeRelation('task-1', 'task-2')
      expect(promise).rejects.toMatchObject({ appError: { code: 'relation-not-found' } })
      await promise.catch(() => {})
    })
  })

  describe('updateRelation', () => {
    test('fetches task, finds relation, updates its type', async () => {
      const descriptionWithRelation = '---\nblocks: task-2\n---\nTask body'
      let putBody: unknown

      setMockFetch((url, options) => {
        if (url.includes('/task/task-1') && options.method === 'GET') {
          return Promise.resolve(
            new Response(JSON.stringify({ ...taskBase, description: descriptionWithRelation }), { status: 200 }),
          )
        }
        if (url.includes('/task/description/task-1') && options.method === 'PUT') {
          putBody = typeof options.body === 'string' ? JSON.parse(options.body) : undefined
          return Promise.resolve(new Response(JSON.stringify(taskBase), { status: 200 }))
        }
        return Promise.resolve(new Response(JSON.stringify({}), { status: 200 }))
      })

      const resource = new TaskResource(mockConfig)
      const result = await resource.updateRelation('task-1', 'task-2', 'related')

      expect(result.taskId).toBe('task-1')
      expect(result.relatedTaskId).toBe('task-2')
      expect(result.type).toBe('related')
      expect(putBody).toMatchObject({ description: expect.stringContaining('task-2') as unknown })
      expect(putBody).not.toMatchObject({ description: expect.stringContaining('blocks:') as unknown })
    })

    test('throws relationNotFound when relation does not exist', async () => {
      setMockFetch((url, options) => {
        if (url.includes('/task/task-1') && options.method === 'GET') {
          return Promise.resolve(
            new Response(JSON.stringify({ ...taskBase, description: '---\nrelated: task-3\n---' }), { status: 200 }),
          )
        }
        return Promise.resolve(new Response(JSON.stringify({}), { status: 200 }))
      })

      const resource = new TaskResource(mockConfig)
      const promise = resource.updateRelation('task-1', 'task-2', 'blocks')
      expect(promise).rejects.toMatchObject({ appError: { code: 'relation-not-found' } })
      await promise.catch(() => {})
    })

    test('throws when task does not exist', async () => {
      setMockFetch(() => Promise.resolve(new Response(JSON.stringify({ error: 'Task not found' }), { status: 404 })))

      const resource = new TaskResource(mockConfig)
      const promise = resource.updateRelation('missing', 'task-2', 'related')
      expect(promise).rejects.toThrow()
      await promise.catch(() => {})
    })

    test('updates only the matching relation when multiple relations exist', async () => {
      const descriptionWithMultiple = '---\nblocks: task-2\nrelated: task-3\n---\nBody'
      let putBody: unknown

      setMockFetch((url, options) => {
        if (url.includes('/task/task-1') && options.method === 'GET') {
          return Promise.resolve(
            new Response(JSON.stringify({ ...taskBase, description: descriptionWithMultiple }), { status: 200 }),
          )
        }
        if (url.includes('/task/description/task-1') && options.method === 'PUT') {
          putBody = typeof options.body === 'string' ? JSON.parse(options.body) : undefined
          return Promise.resolve(new Response(JSON.stringify(taskBase), { status: 200 }))
        }
        return Promise.resolve(new Response(JSON.stringify({}), { status: 200 }))
      })

      const resource = new TaskResource(mockConfig)
      await resource.updateRelation('task-1', 'task-2', 'duplicate')

      if (!isUpdateDescriptionBody(putBody)) {
        throw new Error('putBody is not UpdateDescriptionBody')
      }
      expect(putBody.description).toContain('task-3')
      expect(putBody.description).toContain('task-2')
    })
  })
})
