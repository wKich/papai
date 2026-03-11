import { beforeEach, describe, expect, mock, test } from 'bun:test'

import type { KaneoConfig } from '../../src/kaneo/client.js'
import { LabelResource } from '../../src/kaneo/index.js'

function setMockFetch(mockFn: (...args: unknown[]) => Promise<Response>): void {
  const originalFetch = globalThis.fetch
  const mockWithProperties = Object.assign(mockFn, {
    preconnect: originalFetch.preconnect,
  })
  globalThis.fetch = mockWithProperties as typeof globalThis.fetch
}

describe('LabelResource', () => {
  const mockConfig: KaneoConfig = {
    apiKey: 'test-key',
    baseUrl: 'https://api.test.com',
  }

  beforeEach(() => {
    mock.restore()
  })

  describe('create', () => {
    test('creates label with required fields', async () => {
      setMockFetch(
        mock(() =>
          Promise.resolve(
            new Response(
              JSON.stringify({
                id: 'label-1',
                name: 'new-label',
                color: '#6b7280',
              }),
              { status: 200 },
            ),
          ),
        ),
      )

      const resource = new LabelResource(mockConfig)
      const result = await resource.create({
        workspaceId: 'ws-1',
        name: 'new-label',
      })

      expect(result.id).toBe('label-1')
      expect(result.name).toBe('new-label')
    })

    test('uses default color when not provided', async () => {
      let capturedBody: unknown
      setMockFetch(
        mock((_url: string, options: RequestInit) => {
          capturedBody = typeof options.body === 'string' ? JSON.parse(options.body) : undefined
          return Promise.resolve(
            new Response(
              JSON.stringify({
                id: 'label-1',
                name: 'new-label',
                color: '#6b7280',
              }),
              { status: 200 },
            ),
          )
        }),
      )

      const resource = new LabelResource(mockConfig)
      await resource.create({
        workspaceId: 'ws-1',
        name: 'new-label',
      })

      expect(capturedBody).toMatchObject({ color: '#6b7280' })
    })

    test('accepts custom color', async () => {
      let capturedBody: unknown
      setMockFetch(
        mock((_url: string, options: RequestInit) => {
          capturedBody = typeof options.body === 'string' ? JSON.parse(options.body) : undefined
          return Promise.resolve(
            new Response(
              JSON.stringify({
                id: 'label-1',
                name: 'urgent',
                color: '#ff0000',
              }),
              { status: 200 },
            ),
          )
        }),
      )

      const resource = new LabelResource(mockConfig)
      await resource.create({
        workspaceId: 'ws-1',
        name: 'urgent',
        color: '#ff0000',
      })

      expect(capturedBody).toMatchObject({ color: '#ff0000' })
    })

    test('includes workspaceId in request', async () => {
      let capturedBody: unknown
      setMockFetch(
        mock((_url: string, options: RequestInit) => {
          capturedBody = typeof options.body === 'string' ? JSON.parse(options.body) : undefined
          return Promise.resolve(
            new Response(
              JSON.stringify({
                id: 'label-1',
                name: 'test',
                color: '#6b7280',
              }),
              { status: 200 },
            ),
          )
        }),
      )

      const resource = new LabelResource(mockConfig)
      await resource.create({
        workspaceId: 'ws-1',
        name: 'test',
      })

      expect(capturedBody).toMatchObject({ workspaceId: 'ws-1' })
    })

    test('throws on API error', async () => {
      setMockFetch(
        mock(() => Promise.resolve(new Response(JSON.stringify({ error: 'Invalid request' }), { status: 400 }))),
      )

      const resource = new LabelResource(mockConfig)
      const promise = resource.create({
        workspaceId: 'ws-1',
        name: 'test',
      })
      expect(promise).rejects.toThrow()
      await promise.catch(() => {})
    })
  })

  describe('list', () => {
    test('returns all labels for workspace', async () => {
      setMockFetch(
        mock(() =>
          Promise.resolve(
            new Response(
              JSON.stringify([
                { id: 'label-1', name: 'bug', color: '#ff0000' },
                { id: 'label-2', name: 'feature', color: '#00ff00' },
              ]),
              { status: 200 },
            ),
          ),
        ),
      )

      const resource = new LabelResource(mockConfig)
      const result = await resource.list('ws-1')

      expect(result).toHaveLength(2)
      expect(result[0].name).toBe('bug')
      expect(result[1].name).toBe('feature')
    })

    test('returns empty array when no labels', async () => {
      setMockFetch(mock(() => Promise.resolve(new Response(JSON.stringify([]), { status: 200 }))))

      const resource = new LabelResource(mockConfig)
      const result = await resource.list('ws-1')

      expect(result).toHaveLength(0)
    })

    test('throws on API error', async () => {
      setMockFetch(
        mock(() => Promise.resolve(new Response(JSON.stringify({ error: 'Workspace not found' }), { status: 404 }))),
      )

      const resource = new LabelResource(mockConfig)
      const promise = resource.list('invalid-ws')
      expect(promise).rejects.toThrow()
      await promise.catch(() => {})
    })
  })

  describe('update', () => {
    test('updates only name', async () => {
      let capturedBody: unknown
      setMockFetch(
        mock((_url: string, options: RequestInit) => {
          capturedBody = typeof options.body === 'string' ? JSON.parse(options.body) : undefined
          return Promise.resolve(
            new Response(
              JSON.stringify({
                id: 'label-1',
                name: 'Updated Name',
                color: '#ff0000',
              }),
              { status: 200 },
            ),
          )
        }),
      )

      const resource = new LabelResource(mockConfig)
      const result = await resource.update('label-1', { name: 'Updated Name' })

      expect(capturedBody).toEqual({ name: 'Updated Name' })
      expect(result.name).toBe('Updated Name')
    })

    test('updates only color', async () => {
      let capturedBody: unknown
      setMockFetch(
        mock((_url: string, options: RequestInit) => {
          capturedBody = typeof options.body === 'string' ? JSON.parse(options.body) : undefined
          return Promise.resolve(
            new Response(
              JSON.stringify({
                id: 'label-1',
                name: 'bug',
                color: '#00ff00',
              }),
              { status: 200 },
            ),
          )
        }),
      )

      const resource = new LabelResource(mockConfig)
      await resource.update('label-1', { color: '#00ff00' })

      expect(capturedBody).toEqual({ color: '#00ff00' })
    })

    test('updates both name and color', async () => {
      let capturedBody: unknown
      setMockFetch(
        mock((_url: string, options: RequestInit) => {
          capturedBody = typeof options.body === 'string' ? JSON.parse(options.body) : undefined
          return Promise.resolve(
            new Response(
              JSON.stringify({
                id: 'label-1',
                name: 'New Name',
                color: '#0000ff',
              }),
              { status: 200 },
            ),
          )
        }),
      )

      const resource = new LabelResource(mockConfig)
      await resource.update('label-1', { name: 'New Name', color: '#0000ff' })

      expect(capturedBody).toMatchObject({
        name: 'New Name',
        color: '#0000ff',
      })
    })

    test('throws labelNotFound for 404', async () => {
      setMockFetch(
        mock(() => Promise.resolve(new Response(JSON.stringify({ error: 'Label not found' }), { status: 404 }))),
      )

      const resource = new LabelResource(mockConfig)
      const promise = resource.update('invalid', { name: 'Test' })
      expect(promise).rejects.toMatchObject({
        appError: { code: 'label-not-found' },
      })
      await promise.catch(() => {})
    })
  })

  describe('remove', () => {
    test('removes label successfully', async () => {
      setMockFetch(mock(() => Promise.resolve(new Response(JSON.stringify({ success: true }), { status: 200 }))))

      const resource = new LabelResource(mockConfig)
      const result = await resource.remove('label-1')

      expect(result.id).toBe('label-1')
      expect(result.success).toBe(true)
    })

    test('throws labelNotFound for 404', async () => {
      setMockFetch(
        mock(() => Promise.resolve(new Response(JSON.stringify({ error: 'Label not found' }), { status: 404 }))),
      )

      const resource = new LabelResource(mockConfig)
      const promise = resource.remove('invalid')
      expect(promise).rejects.toMatchObject({
        appError: { code: 'label-not-found' },
      })
      await promise.catch(() => {})
    })
  })

  describe('addToTask', () => {
    test('fetches label and creates task-label', async () => {
      let callCount = 0
      setMockFetch(
        mock((url: string) => {
          callCount++

          if (url.includes('/label/label-1') && !url.includes('/task')) {
            return Promise.resolve(
              new Response(
                JSON.stringify({
                  id: 'label-1',
                  name: 'bug',
                  color: '#ff0000',
                }),
                { status: 200 },
              ),
            )
          }

          if (url.includes('/label') && !url.includes('/label-1')) {
            return Promise.resolve(
              new Response(
                JSON.stringify({
                  id: 'tl-1',
                  name: 'bug',
                  color: '#ff0000',
                  taskId: 'task-1',
                }),
                { status: 200 },
              ),
            )
          }

          return Promise.resolve(new Response(JSON.stringify({}), { status: 200 }))
        }),
      )

      const resource = new LabelResource(mockConfig)
      const result = await resource.addToTask('task-1', 'label-1', 'ws-1')

      expect(callCount).toBe(2)
      expect(result.taskId).toBe('task-1')
      expect(result.labelId).toBe('label-1')
    })

    test('throws labelNotFound when label does not exist', async () => {
      setMockFetch(
        mock(() => Promise.resolve(new Response(JSON.stringify({ error: 'Label not found' }), { status: 404 }))),
      )

      const resource = new LabelResource(mockConfig)
      const promise = resource.addToTask('task-1', 'invalid-label', 'ws-1')
      expect(promise).rejects.toMatchObject({
        appError: { code: 'label-not-found' },
      })
      await promise.catch(() => {})
    })

    test('includes label details in task-label creation', async () => {
      let taskLabelBody: unknown
      setMockFetch(
        mock((url: string, options?: RequestInit) => {
          if (url.includes('/label/label-1') && !url.includes('/task')) {
            return Promise.resolve(
              new Response(
                JSON.stringify({
                  id: 'label-1',
                  name: 'urgent',
                  color: '#ff0000',
                }),
                { status: 200 },
              ),
            )
          }

          if (options?.method === 'POST') {
            taskLabelBody = typeof options.body === 'string' ? JSON.parse(options.body) : undefined
          }

          return Promise.resolve(
            new Response(
              JSON.stringify({
                id: 'tl-1',
                name: 'urgent',
                color: '#ff0000',
                taskId: 'task-1',
              }),
              { status: 200 },
            ),
          )
        }),
      )

      const resource = new LabelResource(mockConfig)
      await resource.addToTask('task-1', 'label-1', 'ws-1')

      expect(taskLabelBody).toMatchObject({
        name: 'urgent',
        color: '#ff0000',
        workspaceId: 'ws-1',
        taskId: 'task-1',
      })
    })
  })

  describe('removeFromTask', () => {
    test('finds and deletes task label', async () => {
      let callCount = 0
      let deleteUrl: string | undefined

      setMockFetch(
        mock((url: string, options?: RequestInit) => {
          callCount++

          if (url.includes('/label/task/task-1')) {
            return Promise.resolve(
              new Response(
                JSON.stringify([
                  { id: 'label-bug', name: 'bug', color: '#ff0000' },
                  { id: 'label-urgent', name: 'urgent', color: '#ff0000' },
                ]),
                { status: 200 },
              ),
            )
          }

          if (options?.method === 'DELETE') {
            deleteUrl = url
            return Promise.resolve(new Response(JSON.stringify({ success: true }), { status: 200 }))
          }

          return Promise.resolve(new Response(JSON.stringify({}), { status: 200 }))
        }),
      )

      const resource = new LabelResource(mockConfig)
      const result = await resource.removeFromTask('task-1', 'label-bug')

      expect(callCount).toBe(2)
      expect(deleteUrl).toContain('/label/label-bug')
      expect(result.taskId).toBe('task-1')
      expect(result.labelId).toBe('label-bug')
      expect(result.success).toBe(true)
    })

    test('handles when task has no labels (returns success)', async () => {
      setMockFetch(
        mock((url: string) => {
          if (url.includes('/label/task/')) {
            return Promise.resolve(new Response(JSON.stringify([]), { status: 200 }))
          }
          return Promise.resolve(new Response(JSON.stringify({}), { status: 200 }))
        }),
      )

      const resource = new LabelResource(mockConfig)
      const result = await resource.removeFromTask('task-1', 'label-bug')

      expect(result.taskId).toBe('task-1')
      expect(result.labelId).toBe('label-bug')
      expect(result.success).toBe(true)
    })

    test('handles when label not found on task', async () => {
      setMockFetch(
        mock((url: string) => {
          if (url.includes('/label/task/')) {
            return Promise.resolve(
              new Response(JSON.stringify([{ id: 'label-other', name: 'other', color: '#ff0000' }]), { status: 200 }),
            )
          }
          return Promise.resolve(new Response(JSON.stringify({}), { status: 200 }))
        }),
      )

      const resource = new LabelResource(mockConfig)
      const result = await resource.removeFromTask('task-1', 'label-missing')

      expect(result.taskId).toBe('task-1')
      expect(result.labelId).toBe('label-missing')
      expect(result.success).toBe(true)
    })
  })
})
