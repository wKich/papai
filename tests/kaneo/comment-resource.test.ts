import { afterEach, beforeEach, describe, expect, mock, test } from 'bun:test'

import type { KaneoConfig } from '../../src/kaneo/client.js'
import { CommentResource } from '../../src/kaneo/index.js'
import { restoreFetch, setMockFetch } from '../test-helpers.js'

describe('CommentResource', () => {
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

  describe('add', () => {
    test('adds comment to task', async () => {
      let capturedBody: unknown
      let callCount = 0
      setMockFetch((_url: string, options: RequestInit) => {
        callCount++
        // First call is POST /activity/comment
        if (callCount === 1) {
          capturedBody = typeof options.body === 'string' ? JSON.parse(options.body) : undefined
          // Kaneo returns a raw Drizzle insert result, not an activity object
          return Promise.resolve(new Response(JSON.stringify({ rowCount: 1 }), { status: 200 }))
        }
        // Second call is GET /activity/{taskId} to fetch the created comment
        return Promise.resolve(
          new Response(
            JSON.stringify([
              {
                id: 'comment-1',
                type: 'comment',
                message: 'New comment',
                createdAt: '2026-03-01T00:00:00Z',
              },
            ]),
            { status: 200 },
          ),
        )
      })

      const resource = new CommentResource(mockConfig)
      const result = await resource.add('task-1', 'New comment')

      expect(capturedBody).toMatchObject({
        taskId: 'task-1',
        comment: 'New comment',
      })
      expect(result.id).toBe('comment-1')
      expect(result.comment).toBe('New comment')
      expect(result.createdAt).toBe('2026-03-01T00:00:00Z')
    })

    test('handles empty comment', async () => {
      let callCount = 0
      setMockFetch(() => {
        callCount++
        if (callCount === 1) {
          return Promise.resolve(new Response(JSON.stringify({ rowCount: 1 }), { status: 200 }))
        }
        return Promise.resolve(
          new Response(
            JSON.stringify([
              {
                id: 'comment-1',
                type: 'comment',
                message: '',
                createdAt: '2026-03-01T00:00:00Z',
              },
            ]),
            { status: 200 },
          ),
        )
      })

      const resource = new CommentResource(mockConfig)
      const result = await resource.add('task-1', '')

      expect(result.comment).toBe('')
      expect(result.id).toBe('comment-1')
      expect(result.createdAt).toBe('2026-03-01T00:00:00Z')
    })

    test('handles long comment', async () => {
      const longComment = 'a'.repeat(1000)
      let callCount = 0
      setMockFetch(() => {
        callCount++
        if (callCount === 1) {
          return Promise.resolve(new Response(JSON.stringify({ rowCount: 1 }), { status: 200 }))
        }
        return Promise.resolve(
          new Response(
            JSON.stringify([
              {
                id: 'comment-1',
                type: 'comment',
                message: longComment,
                createdAt: '2026-03-01T00:00:00Z',
              },
            ]),
            { status: 200 },
          ),
        )
      })

      const resource = new CommentResource(mockConfig)
      const result = await resource.add('task-1', longComment)

      expect(result.comment).toBe(longComment)
      expect(result.id).toBe('comment-1')
      expect(result.createdAt).toBe('2026-03-01T00:00:00Z')
    })

    test('throws taskNotFound for 404', async () => {
      setMockFetch(() => Promise.resolve(new Response(JSON.stringify({ error: 'Task not found' }), { status: 404 })))

      const resource = new CommentResource(mockConfig)
      const promise = resource.add('invalid', 'Test')
      expect(promise).rejects.toMatchObject({
        appError: { code: 'comment-not-found' },
      })
      await promise.catch(() => {})
    })
  })

  describe('list', () => {
    test('filters only comment activities', async () => {
      setMockFetch(() =>
        Promise.resolve(
          new Response(
            JSON.stringify([
              {
                id: 'act-1',
                type: 'comment',
                message: 'Comment 1',
                createdAt: '2026-03-01T00:00:00Z',
              },
              {
                id: 'act-2',
                type: 'status_change',
                message: 'Status changed',
                createdAt: '2026-03-01T00:00:00Z',
              },
              {
                id: 'act-3',
                type: 'comment',
                message: 'Comment 2',
                createdAt: '2026-03-02T00:00:00Z',
              },
            ]),
            { status: 200 },
          ),
        ),
      )

      const resource = new CommentResource(mockConfig)
      const result = await resource.list('task-1')

      expect(result).toHaveLength(2)
      expect(result[0]?.comment).toBe('Comment 1')
      expect(result[1]?.comment).toBe('Comment 2')
    })

    test('excludes activities with null message', async () => {
      setMockFetch(() =>
        Promise.resolve(
          new Response(
            JSON.stringify([
              {
                id: 'act-1',
                type: 'comment',
                message: 'Valid comment',
                createdAt: '2026-03-01T00:00:00Z',
              },
              { id: 'act-2', type: 'comment', message: null, createdAt: '2026-03-01T00:00:00Z' },
            ]),
            { status: 200 },
          ),
        ),
      )

      const resource = new CommentResource(mockConfig)
      const result = await resource.list('task-1')

      expect(result).toHaveLength(1)
      expect(result[0]?.comment).toBe('Valid comment')
    })

    test('returns empty array when no comments', async () => {
      setMockFetch(() =>
        Promise.resolve(
          new Response(
            JSON.stringify([
              {
                id: 'act-1',
                type: 'status_change',
                message: 'Changed',
                createdAt: '2026-03-01T00:00:00Z',
              },
            ]),
            { status: 200 },
          ),
        ),
      )

      const resource = new CommentResource(mockConfig)
      const result = await resource.list('task-1')

      expect(result).toHaveLength(0)
    })

    test('maps to simplified structure', async () => {
      setMockFetch(() =>
        Promise.resolve(
          new Response(
            JSON.stringify([{ id: 'act-1', type: 'comment', message: 'Test', createdAt: '2026-03-01T12:00:00Z' }]),
            { status: 200 },
          ),
        ),
      )

      const resource = new CommentResource(mockConfig)
      const result = await resource.list('task-1')

      expect(result[0]).toMatchObject({
        id: 'act-1',
        comment: 'Test',
        createdAt: '2026-03-01T12:00:00Z',
      })
    })

    test('throws taskNotFound for 404', async () => {
      setMockFetch(() => Promise.resolve(new Response(JSON.stringify({ error: 'Task not found' }), { status: 404 })))

      const resource = new CommentResource(mockConfig)
      const promise = resource.list('invalid')
      expect(promise).rejects.toMatchObject({
        appError: { code: 'comment-not-found' },
      })
      await promise.catch(() => {})
    })
  })

  describe('update', () => {
    test('updates existing comment', async () => {
      let capturedBody: unknown
      setMockFetch((_url: string, options: RequestInit) => {
        capturedBody = typeof options.body === 'string' ? JSON.parse(options.body) : undefined
        return Promise.resolve(
          new Response(
            JSON.stringify({
              id: 'comment-1',
              comment: 'Updated',
              createdAt: '2026-03-01T00:00:00Z',
            }),
            { status: 200 },
          ),
        )
      })

      const resource = new CommentResource(mockConfig)
      const result = await resource.update('comment-1', 'Updated')

      expect(capturedBody).toMatchObject({
        activityId: 'comment-1',
        comment: 'Updated',
      })
      expect(result.id).toBe('comment-1')
      expect(result.comment).toBe('Updated')
      expect(result.createdAt).toBe('2026-03-01T00:00:00Z')
    })

    test('throws commentNotFound for 404', async () => {
      setMockFetch(() => Promise.resolve(new Response(JSON.stringify({ error: 'Comment not found' }), { status: 404 })))

      const resource = new CommentResource(mockConfig)
      const promise = resource.update('invalid', 'Updated')
      expect(promise).rejects.toMatchObject({
        appError: { code: 'comment-not-found' },
      })
      await promise.catch(() => {})
    })
  })

  describe('remove', () => {
    test('removes comment successfully', async () => {
      setMockFetch(() => Promise.resolve(new Response(JSON.stringify({ success: true }), { status: 200 })))

      const resource = new CommentResource(mockConfig)
      const result = await resource.remove('comment-1')

      expect(result.id).toBe('comment-1')
      expect(result.success).toBe(true)
    })

    test('throws commentNotFound for 404', async () => {
      setMockFetch(() => Promise.resolve(new Response(JSON.stringify({ error: 'Comment not found' }), { status: 404 })))

      const resource = new CommentResource(mockConfig)
      const promise = resource.remove('invalid')
      expect(promise).rejects.toMatchObject({
        appError: { code: 'comment-not-found' },
      })
      await promise.catch(() => {})
    })
  })
})
