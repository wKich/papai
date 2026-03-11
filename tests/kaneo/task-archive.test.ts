import { beforeEach, describe, expect, mock, test } from 'bun:test'

import type { KaneoConfig } from '../../src/kaneo/client.js'
import { addArchiveLabel, getOrCreateArchiveLabel, isTaskArchived } from '../../src/kaneo/index.js'

// Helper to set fetch mock
function setMockFetch(mockFn: () => Promise<Response>): void {
  const originalFetch = globalThis.fetch
  const mockWithProperties = Object.assign(mockFn, {
    preconnect: originalFetch.preconnect,
  })
  globalThis.fetch = mockWithProperties
}

describe('Archive Label Management', () => {
  const mockConfig: KaneoConfig = {
    apiKey: 'test-key',
    baseUrl: 'https://api.test.com',
  }

  beforeEach(() => {
    mock.restore()
  })

  describe('getOrCreateArchiveLabel', () => {
    test('returns existing archived label', async () => {
      const mockFetch = mock(() =>
        Promise.resolve(
          new Response(
            JSON.stringify([
              { id: 'label-1', name: 'bug', color: '#ff0000', workspaceId: 'ws-1' },
              { id: 'label-archive', name: 'archived', color: '#808080', workspaceId: 'ws-1' },
            ]),
            { status: 200 },
          ),
        ),
      )
      setMockFetch(mockFetch)

      const result = await getOrCreateArchiveLabel(mockConfig, 'ws-1')
      expect(result.id).toBe('label-archive')
      expect(result.name).toBe('archived')
    })

    test('is case insensitive when finding label', async () => {
      const mockFetch = mock(() =>
        Promise.resolve(
          new Response(JSON.stringify([{ id: 'label-1', name: 'ARCHIVED', color: '#808080', workspaceId: 'ws-1' }]), {
            status: 200,
          }),
        ),
      )
      setMockFetch(mockFetch)

      const result = await getOrCreateArchiveLabel(mockConfig, 'ws-1')
      expect(result.id).toBe('label-1')
    })

    test('creates new label if not exists', async () => {
      let callCount = 0
      const mockFetch = mock((_url: string, options: RequestInit) => {
        callCount++
        if (options.method === 'GET') {
          return Promise.resolve(
            new Response(JSON.stringify([{ id: 'label-1', name: 'bug', color: '#ff0000', workspaceId: 'ws-1' }]), {
              status: 200,
            }),
          )
        }
        // POST create label
        return Promise.resolve(
          new Response(
            JSON.stringify({
              id: 'label-new',
              name: 'archived',
              color: '#808080',
              workspaceId: 'ws-1',
            }),
            { status: 200 },
          ),
        )
      })
      setMockFetch(mockFetch as unknown as () => Promise<Response>)

      const result = await getOrCreateArchiveLabel(mockConfig, 'ws-1')
      expect(result.name).toBe('archived')
      expect(result.color).toBe('#808080')
      expect(callCount).toBe(2)
    })

    test('uses correct archive label color', async () => {
      let capturedBody: unknown
      const mockFetch = mock((_url: string, options: RequestInit) => {
        if (options.method === 'GET') {
          return Promise.resolve(new Response(JSON.stringify([]), { status: 200 }))
        }
        if (options.method === 'POST') {
          capturedBody = typeof options.body === 'string' ? JSON.parse(options.body) : undefined
        }
        return Promise.resolve(
          new Response(
            JSON.stringify({
              id: 'label-1',
              name: 'archived',
              color: '#808080',
              workspaceId: 'ws-1',
            }),
            { status: 200 },
          ),
        )
      })
      setMockFetch(mockFetch as unknown as () => Promise<Response>)

      await getOrCreateArchiveLabel(mockConfig, 'ws-1')
      expect(capturedBody).toMatchObject({ color: '#808080' })
    })
  })

  describe('isTaskArchived', () => {
    test('returns true when task has archive label', async () => {
      const mockFetch = mock(() =>
        Promise.resolve(
          new Response(
            JSON.stringify([
              { id: 'label-1', name: 'bug', color: '#ff0000', workspaceId: 'ws-1' },
              { id: 'label-archive', name: 'archived', color: '#808080', workspaceId: 'ws-1' },
            ]),
            { status: 200 },
          ),
        ),
      )
      setMockFetch(mockFetch)

      const result = await isTaskArchived(mockConfig, 'task-1', 'label-archive')
      expect(result).toBe(true)
    })

    test('returns false when task has no archive label', async () => {
      const mockFetch = mock(() =>
        Promise.resolve(
          new Response(JSON.stringify([{ id: 'label-1', name: 'bug', color: '#ff0000', workspaceId: 'ws-1' }]), {
            status: 200,
          }),
        ),
      )
      setMockFetch(mockFetch)

      const result = await isTaskArchived(mockConfig, 'task-1', 'label-archive')
      expect(result).toBe(false)
    })

    test('returns false when task has no labels', async () => {
      const mockFetch = mock(() => Promise.resolve(new Response(JSON.stringify([]), { status: 200 })))
      setMockFetch(mockFetch)

      const result = await isTaskArchived(mockConfig, 'task-1', 'label-archive')
      expect(result).toBe(false)
    })
  })

  describe('addArchiveLabel', () => {
    test('adds archive label to task', async () => {
      let requestBody: unknown
      const mockFetch = mock((_url: string, options: RequestInit) => {
        if (options.method === 'GET') {
          // First call: get archive label
          if (_url.includes('/label/workspace/')) {
            return Promise.resolve(
              new Response(JSON.stringify([{ id: 'label-archive', name: 'archived', color: '#808080' }]), {
                status: 200,
              }),
            )
          }
          // Second call: get specific label
          if (_url.includes('/label/label-archive')) {
            return Promise.resolve(
              new Response(JSON.stringify({ id: 'label-archive', name: 'archived', color: '#808080' }), {
                status: 200,
              }),
            )
          }
        }
        if (options.method === 'POST') {
          requestBody = typeof options.body === 'string' ? JSON.parse(options.body) : undefined
          // Return a valid KaneoLabelWithTaskSchema response
          return Promise.resolve(
            new Response(
              JSON.stringify({
                id: 'tl-1',
                name: 'archived',
                color: '#808080',
                taskId: 'task-1',
              }),
              { status: 200 },
            ),
          )
        }
        return Promise.resolve(new Response('{}', { status: 200 }))
      })
      setMockFetch(mockFetch as unknown as () => Promise<Response>)

      await addArchiveLabel(mockConfig, 'ws-1', 'task-1')

      expect(requestBody).toMatchObject({
        taskId: 'task-1',
        name: 'archived',
        color: '#808080',
      })
    })

    test('creates archive label if not exists before adding', async () => {
      let callCount = 0
      const mockFetch = mock((_url: string, options: RequestInit) => {
        callCount++

        if (options.method === 'GET' && _url.includes('/label/workspace/')) {
          // No existing archive label
          return Promise.resolve(
            new Response(JSON.stringify([{ id: 'label-1', name: 'bug', color: '#ff0000', workspaceId: 'ws-1' }]), {
              status: 200,
            }),
          )
        }

        if (options.method === 'POST') {
          const parsedBody: unknown = typeof options.body === 'string' ? JSON.parse(options.body) : {}
          const body = typeof parsedBody === 'object' && parsedBody !== null ? parsedBody : {}
          if ('taskId' in body && typeof body['taskId'] === 'string') {
            // Adding label to task - returns KaneoLabelWithTaskSchema
            return Promise.resolve(
              new Response(
                JSON.stringify({
                  id: 'tl-1',
                  name: 'archived',
                  color: '#808080',
                  taskId: 'task-1',
                }),
                { status: 200 },
              ),
            )
          }
          // Creating archive label - returns KaneoLabelSchema
          return Promise.resolve(
            new Response(
              JSON.stringify({
                id: 'label-new',
                name: 'archived',
                color: '#808080',
              }),
              { status: 200 },
            ),
          )
        }

        if (options.method === 'GET' && _url.includes('/label/')) {
          // GET /label/:id - returns KaneoLabelSchema
          return Promise.resolve(
            new Response(JSON.stringify({ id: 'label-new', name: 'archived', color: '#808080' }), {
              status: 200,
            }),
          )
        }

        return Promise.resolve(new Response(JSON.stringify({}), { status: 200 }))
      })
      setMockFetch(mockFetch as unknown as () => Promise<Response>)

      await addArchiveLabel(mockConfig, 'ws-1', 'task-1')

      expect(callCount).toBeGreaterThanOrEqual(3)
    })
  })
})
