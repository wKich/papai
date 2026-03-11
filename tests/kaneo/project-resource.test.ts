import { afterEach, beforeEach, describe, expect, mock, test } from 'bun:test'

import type { KaneoConfig } from '../../src/kaneo/client.js'
import { ProjectResource } from '../../src/kaneo/index.js'
import { restoreFetch, setMockFetch } from '../test-helpers.js'

describe('ProjectResource', () => {
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
    test('creates project with required fields', async () => {
      setMockFetch(() =>
        Promise.resolve(
          new Response(
            JSON.stringify({
              id: 'proj-1',
              name: 'My Project',
              slug: 'my-project',
            }),
            { status: 200 },
          ),
        ),
      )

      const resource = new ProjectResource(mockConfig)
      const result = await resource.create({
        workspaceId: 'ws-1',
        name: 'My Project',
      })

      expect(result.id).toBe('proj-1')
      expect(result.name).toBe('My Project')
      expect(result.slug).toBe('my-project')
    })

    test('auto-generates slug from name', async () => {
      let capturedBody: unknown
      setMockFetch((_url, options) => {
        if (options.method === 'POST') {
          capturedBody = typeof options.body === 'string' ? JSON.parse(options.body) : undefined
        }
        return Promise.resolve(
          new Response(
            JSON.stringify({
              id: 'proj-1',
              name: 'My Project',
              slug: 'my-project',
            }),
            { status: 200 },
          ),
        )
      })

      const resource = new ProjectResource(mockConfig)
      await resource.create({
        workspaceId: 'ws-1',
        name: 'My Project',
      })

      expect(capturedBody).toMatchObject({ slug: 'my-project' })
    })

    test('generates slug with special characters', async () => {
      let capturedBody: unknown
      setMockFetch((_url, options) => {
        if (options.method === 'POST') {
          capturedBody = typeof options.body === 'string' ? JSON.parse(options.body) : undefined
        }
        return Promise.resolve(
          new Response(
            JSON.stringify({
              id: 'proj-1',
              name: 'My Project @ Test!',
              slug: 'my-project-test',
            }),
            { status: 200 },
          ),
        )
      })

      const resource = new ProjectResource(mockConfig)
      await resource.create({
        workspaceId: 'ws-1',
        name: 'My Project @ Test!',
      })

      expect(capturedBody).toMatchObject({ slug: 'my-project-test' })
    })

    test('includes workspaceId and empty icon in request', async () => {
      let capturedBody: unknown
      setMockFetch((_url, options) => {
        capturedBody = typeof options.body === 'string' ? JSON.parse(options.body) : undefined
        return Promise.resolve(
          new Response(
            JSON.stringify({
              id: 'proj-1',
              name: 'Test',
              slug: 'test',
            }),
            { status: 200 },
          ),
        )
      })

      const resource = new ProjectResource(mockConfig)
      await resource.create({
        workspaceId: 'ws-1',
        name: 'Test',
      })

      expect(capturedBody).toMatchObject({
        name: 'Test',
        workspaceId: 'ws-1',
        icon: '',
      })
    })

    test('updates description in separate call', async () => {
      let callCount = 0
      let lastUrl: string | undefined
      let lastBody: unknown

      setMockFetch((url, options) => {
        callCount++
        if (options.method !== 'POST') {
          lastUrl = url
          lastBody = typeof options.body === 'string' ? JSON.parse(options.body) : undefined
        }

        return Promise.resolve(
          new Response(
            JSON.stringify({
              id: 'proj-1',
              name: 'Test Project',
              slug: 'test-project',
            }),
            { status: 200 },
          ),
        )
      })

      const resource = new ProjectResource(mockConfig)
      await resource.create({
        workspaceId: 'ws-1',
        name: 'Test Project',
        description: 'Project description',
      })

      expect(callCount).toBe(2)
      expect(lastUrl).toContain('/project/proj-1')
      expect(lastBody).toMatchObject({
        name: 'Test Project',
        icon: '',
        slug: 'test-project',
        description: 'Project description',
        isPublic: false,
      })
    })

    test('creates project without description (no second call)', async () => {
      let callCount = 0

      setMockFetch(() => {
        callCount++
        return Promise.resolve(
          new Response(
            JSON.stringify({
              id: 'proj-1',
              name: 'Test',
              slug: 'test',
            }),
            { status: 200 },
          ),
        )
      })

      const resource = new ProjectResource(mockConfig)
      await resource.create({
        workspaceId: 'ws-1',
        name: 'Test',
      })

      expect(callCount).toBe(1)
    })

    test('throws on API error during creation', async () => {
      setMockFetch(() => Promise.resolve(new Response(JSON.stringify({ error: 'Invalid request' }), { status: 400 })))

      const resource = new ProjectResource(mockConfig)
      const promise = resource.create({
        workspaceId: 'ws-1',
        name: 'Test',
      })
      expect(promise).rejects.toThrow()
      await promise.catch(() => {})
    })
  })

  describe('list', () => {
    test('returns all projects for workspace', async () => {
      setMockFetch(() =>
        Promise.resolve(
          new Response(
            JSON.stringify([
              { id: 'proj-1', name: 'Project 1', slug: 'project-1' },
              { id: 'proj-2', name: 'Project 2', slug: 'project-2' },
            ]),
            { status: 200 },
          ),
        ),
      )

      const resource = new ProjectResource(mockConfig)
      const result = await resource.list('ws-1')

      expect(result).toHaveLength(2)
      expect(result[0]?.name).toBe('Project 1')
      expect(result[1]?.name).toBe('Project 2')
    })

    test('returns empty array when no projects', async () => {
      setMockFetch(() => Promise.resolve(new Response(JSON.stringify([]), { status: 200 })))

      const resource = new ProjectResource(mockConfig)
      const result = await resource.list('ws-1')

      expect(result).toHaveLength(0)
    })

    test('includes workspaceId in query params', async () => {
      let requestUrl: string | undefined
      setMockFetch((url) => {
        requestUrl = url
        return Promise.resolve(new Response(JSON.stringify([]), { status: 200 }))
      })

      const resource = new ProjectResource(mockConfig)
      await resource.list('ws-1')

      expect(requestUrl).toContain('workspaceId=ws-1')
    })

    test('throws on API error', async () => {
      setMockFetch(() => Promise.resolve(new Response(JSON.stringify({ error: 'Unauthorized' }), { status: 401 })))

      const resource = new ProjectResource(mockConfig)
      const promise = resource.list('ws-1')
      expect(promise).rejects.toThrow()
      await promise.catch(() => {})
    })
  })

  describe('update', () => {
    test('updates only name', async () => {
      let capturedBody: unknown
      let callCount = 0
      setMockFetch((_url, options) => {
        callCount++
        if (options.method === 'PUT') {
          capturedBody = typeof options.body === 'string' ? JSON.parse(options.body) : undefined
        }
        return Promise.resolve(
          new Response(
            JSON.stringify({
              id: 'proj-1',
              name: 'Updated Name',
              slug: 'old-slug',
              icon: 'Layout',
              description: 'Old description',
              isPublic: false,
            }),
            { status: 200 },
          ),
        )
      })

      const resource = new ProjectResource(mockConfig)
      const result = await resource.update('proj-1', { name: 'Updated Name' })

      expect(callCount).toBe(2)
      expect(capturedBody).toMatchObject({
        name: 'Updated Name',
        slug: 'old-slug',
        icon: 'Layout',
        description: 'Old description',
        isPublic: false,
      })
      expect(result.name).toBe('Updated Name')
    })

    test('updates only description', async () => {
      let capturedBody: unknown
      setMockFetch((_url, options) => {
        if (options.method === 'PUT') {
          capturedBody = typeof options.body === 'string' ? JSON.parse(options.body) : undefined
        }
        return Promise.resolve(
          new Response(
            JSON.stringify({
              id: 'proj-1',
              name: 'Test',
              slug: 'test',
              icon: '',
              description: 'New description',
              isPublic: false,
            }),
            { status: 200 },
          ),
        )
      })

      const resource = new ProjectResource(mockConfig)
      await resource.update('proj-1', { description: 'New description' })

      expect(capturedBody).toMatchObject({
        name: 'Test',
        slug: 'test',
        icon: '',
        description: 'New description',
        isPublic: false,
      })
    })

    test('updates both name and description', async () => {
      let capturedBody: unknown
      setMockFetch((_url, options) => {
        if (options.method === 'PUT') {
          capturedBody = typeof options.body === 'string' ? JSON.parse(options.body) : undefined
        }
        return Promise.resolve(
          new Response(
            JSON.stringify({
              id: 'proj-1',
              name: 'New Name',
              slug: 'test',
              icon: '',
              description: 'New description',
              isPublic: false,
            }),
            { status: 200 },
          ),
        )
      })

      const resource = new ProjectResource(mockConfig)
      await resource.update('proj-1', { name: 'New Name', description: 'New description' })

      expect(capturedBody).toMatchObject({
        name: 'New Name',
        description: 'New description',
      })
    })

    test('throws projectNotFound for 404', async () => {
      setMockFetch(() => Promise.resolve(new Response(JSON.stringify({ error: 'Project not found' }), { status: 404 })))

      const resource = new ProjectResource(mockConfig)
      const promise = resource.update('invalid', { name: 'Test' })
      expect(promise).rejects.toMatchObject({
        appError: { code: 'project-not-found' },
      })
      await promise.catch(() => {})
    })
  })

  describe('archive', () => {
    test('archives project successfully', async () => {
      setMockFetch(() => Promise.resolve(new Response(JSON.stringify({ success: true }), { status: 200 })))

      const resource = new ProjectResource(mockConfig)
      const result = await resource.archive('proj-1')

      expect(result.id).toBe('proj-1')
      expect(result.success).toBe(true)
    })

    test('throws projectNotFound for 404', async () => {
      setMockFetch(() => Promise.resolve(new Response(JSON.stringify({ error: 'Project not found' }), { status: 404 })))

      const resource = new ProjectResource(mockConfig)
      const promise = resource.archive('invalid')
      expect(promise).rejects.toMatchObject({
        appError: { code: 'project-not-found' },
      })
      await promise.catch(() => {})
    })

    test('throws on API error', async () => {
      setMockFetch(() => Promise.resolve(new Response(JSON.stringify({ error: 'Server error' }), { status: 500 })))

      const resource = new ProjectResource(mockConfig)
      const promise = resource.archive('proj-1')
      expect(promise).rejects.toThrow()
      await promise.catch(() => {})
    })
  })
})
