import { afterEach, beforeEach, describe, expect, mock, test } from 'bun:test'

import type { KaneoConfig } from '../../../src/providers/kaneo/client.js'
import { restoreFetch, setMockFetch, createMockActivityForList } from '../../test-helpers.js'
import { CommentResource } from './test-resources.js'

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
      // POST /activity/comment returns {} due to Kaneo bug (missing .returning() on Drizzle insert).
      // See: https://github.com/usekaneo/kaneo/blob/main/apps/api/src/activity/controllers/create-comment.ts
      // Code does POST then GET /activity/:taskId to retrieve the actual created comment.
      let capturedBody: unknown
      setMockFetch((_url: string, options: RequestInit) => {
        if (options.method === 'POST') {
          capturedBody = typeof options.body === 'string' ? JSON.parse(options.body) : undefined
          return Promise.resolve(new Response(JSON.stringify({}), { status: 200 }))
        }
        // GET /activity/:taskId — return array with the created comment
        return Promise.resolve(
          new Response(
            JSON.stringify([
              createMockActivityForList({
                id: 'comment-1',
                taskId: 'task-1',
                type: 'comment',
                userId: 'user-1',
                content: 'New comment',
              }),
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
      setMockFetch((_url: string, options: RequestInit) => {
        if (options.method === 'POST') {
          return Promise.resolve(new Response(JSON.stringify({}), { status: 200 }))
        }
        return Promise.resolve(
          new Response(
            JSON.stringify([
              createMockActivityForList({
                id: 'comment-2',
                taskId: 'task-1',
                type: 'comment',
                userId: 'user-1',
                content: '',
              }),
            ]),
            { status: 200 },
          ),
        )
      })

      const resource = new CommentResource(mockConfig)
      const result = await resource.add('task-1', '')

      expect(result.comment).toBe('')
      expect(result.id).toBe('comment-2')
      expect(result.createdAt).toBe('2026-03-01T00:00:00Z')
    })

    test('handles long comment', async () => {
      const longComment = 'a'.repeat(1000)
      setMockFetch((_url: string, options: RequestInit) => {
        if (options.method === 'POST') {
          return Promise.resolve(new Response(JSON.stringify({}), { status: 200 }))
        }
        return Promise.resolve(
          new Response(
            JSON.stringify([
              createMockActivityForList({
                id: 'comment-3',
                taskId: 'task-1',
                type: 'comment',
                userId: 'user-1',
                content: longComment,
              }),
            ]),
            { status: 200 },
          ),
        )
      })

      const resource = new CommentResource(mockConfig)
      const result = await resource.add('task-1', longComment)

      expect(result.comment).toBe(longComment)
      expect(result.id).toBe('comment-3')
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
              createMockActivityForList({
                id: 'act-1',
                type: 'comment',
                content: 'Comment 1',
                createdAt: '2026-03-01T00:00:00Z',
              }),
              createMockActivityForList({
                id: 'act-2',
                type: 'status_changed',
                content: 'Status changed',
                createdAt: '2026-03-01T00:00:00Z',
              }),
              createMockActivityForList({
                id: 'act-3',
                type: 'comment',
                content: 'Comment 2',
                createdAt: '2026-03-02T00:00:00Z',
              }),
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

    test('excludes activities with null content', async () => {
      setMockFetch(() =>
        Promise.resolve(
          new Response(
            JSON.stringify([
              createMockActivityForList({
                id: 'act-1',
                type: 'comment',
                content: 'Valid comment',
                createdAt: '2026-03-01T00:00:00Z',
              }),
              createMockActivityForList({
                id: 'act-2',
                type: 'comment',
                content: null,
                createdAt: '2026-03-01T00:00:00Z',
              }),
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
              createMockActivityForList({
                id: 'act-1',
                type: 'status_changed',
                content: 'Changed',
                createdAt: '2026-03-01T00:00:00Z',
              }),
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
            JSON.stringify([
              createMockActivityForList({
                id: 'act-1',
                type: 'comment',
                content: 'Test',
                createdAt: '2026-03-01T12:00:00Z',
              }),
            ]),
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
      // PUT /activity/comment returns {} due to Kaneo bug (missing .returning() on Drizzle update).
      // See: https://github.com/usekaneo/kaneo/blob/main/apps/api/src/activity/controllers/update-comment.ts
      // Code does PUT then GET /activity/:taskId to retrieve the actual updated comment.
      let capturedBody: unknown
      setMockFetch((_url: string, options: RequestInit) => {
        if (options.method === 'PUT') {
          capturedBody = typeof options.body === 'string' ? JSON.parse(options.body) : undefined
          return Promise.resolve(new Response(JSON.stringify({}), { status: 200 }))
        }
        // GET /activity/:taskId — return array with the updated comment
        return Promise.resolve(
          new Response(
            JSON.stringify([
              createMockActivityForList({
                id: 'comment-1',
                taskId: 'task-1',
                type: 'comment',
                content: 'Updated',
              }),
            ]),
            { status: 200 },
          ),
        )
      })

      const resource = new CommentResource(mockConfig)
      const result = await resource.update('task-1', 'comment-1', 'Updated')

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
      const promise = resource.update('task-1', 'invalid', 'Updated')
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
