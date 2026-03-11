import { beforeEach, describe, expect, mock, test } from 'bun:test'

import type { KaneoConfig } from '../../src/kaneo/client.js'
import { ColumnResource } from '../../src/kaneo/index.js'

describe('ColumnResource', () => {
  const mockConfig: KaneoConfig = {
    apiKey: 'test-key',
    baseUrl: 'https://api.test.com',
  }

  beforeEach(() => {
    mock.restore()
  })

  describe('list', () => {
    test('returns all columns for project', async () => {
      global.fetch = mock(() =>
        Promise.resolve(
          new Response(
            JSON.stringify([
              { id: 'col-1', name: 'Todo', color: null, isFinal: false },
              { id: 'col-2', name: 'In Progress', color: null, isFinal: false },
              { id: 'col-3', name: 'Done', color: '#00ff00', isFinal: true },
            ]),
            { status: 200 },
          ),
        ),
      )

      const resource = new ColumnResource(mockConfig)
      const result = await resource.list('proj-1')

      expect(result).toHaveLength(3)
      expect(result[0].name).toBe('Todo')
      expect(result[1].name).toBe('In Progress')
      expect(result[2].name).toBe('Done')
    })

    test('returns columns with correct properties', async () => {
      global.fetch = mock(() =>
        Promise.resolve(
          new Response(
            JSON.stringify([
              { id: 'col-3', name: 'Done', color: '#00ff00', isFinal: true },
              { id: 'col-1', name: 'Todo', color: null, isFinal: false },
              { id: 'col-2', name: 'In Progress', color: null, isFinal: false },
            ]),
            { status: 200 },
          ),
        ),
      )

      const resource = new ColumnResource(mockConfig)
      const result = await resource.list('proj-1')

      // Verify columns maintain their structure
      expect(result).toHaveLength(3)
      const col1 = result.find((c) => c.id === 'col-1')
      const col2 = result.find((c) => c.id === 'col-2')
      const col3 = result.find((c) => c.id === 'col-3')
      expect(col1?.isFinal).toBe(false)
      expect(col2?.isFinal).toBe(false)
      expect(col3?.isFinal).toBe(true)
      expect(col1?.color).toBeNull()
      expect(col3?.color).toBe('#00ff00')
    })

    test('returns empty array when no columns', async () => {
      global.fetch = mock(() => Promise.resolve(new Response(JSON.stringify([]), { status: 200 })))

      const resource = new ColumnResource(mockConfig)
      const result = await resource.list('proj-1')

      expect(result).toHaveLength(0)
    })

    test('uses correct API endpoint', async () => {
      let requestUrl: string | undefined
      global.fetch = mock((url: string) => {
        requestUrl = url
        return Promise.resolve(new Response(JSON.stringify([]), { status: 200 }))
      })

      const resource = new ColumnResource(mockConfig)
      await resource.list('proj-1')

      expect(requestUrl).toContain('/column/proj-1')
    })

    test('throws for 404', async () => {
      global.fetch = mock(() =>
        Promise.resolve(new Response(JSON.stringify({ error: 'Project not found' }), { status: 404 })),
      )

      const resource = new ColumnResource(mockConfig)
      const promise = resource.list('invalid')
      expect(promise).rejects.toBeInstanceOf(Error)
      await promise.catch(() => {})
    })

    test('throws on API error', async () => {
      global.fetch = mock(() =>
        Promise.resolve(new Response(JSON.stringify({ error: 'Unauthorized' }), { status: 401 })),
      )

      const resource = new ColumnResource(mockConfig)
      const promise = resource.list('proj-1')
      expect(promise).rejects.toThrow()
      await promise.catch(() => {})
    })

    test('throws on server error', async () => {
      global.fetch = mock(() =>
        Promise.resolve(new Response(JSON.stringify({ error: 'Server error' }), { status: 500 })),
      )

      const resource = new ColumnResource(mockConfig)
      const promise = resource.list('proj-1')
      expect(promise).rejects.toThrow()
      await promise.catch(() => {})
    })
  })
})
