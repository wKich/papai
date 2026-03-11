import { beforeEach, describe, expect, mock, test } from 'bun:test'

import type { KaneoConfig } from '../../src/kaneo/client.js'
import { CommentResource } from '../../src/kaneo/index.js'

describe('CommentResource', () => {
  const mockConfig: KaneoConfig = {
    apiKey: 'test-key',
    baseUrl: 'https://api.test.com',
  }

  beforeEach(() => {
    mock.restore()
  })

  describe('add', () => {
    test('adds comment to task', async () => {
      let capturedBody: unknown
      global.fetch = mock((_url: string, options: RequestInit) => {
        capturedBody = typeof options.body === 'string' ? JSON.parse(options.body) : undefined
        return Promise.resolve(
          new Response(
            JSON.stringify({
              id: 'comment-1',
              comment: 'New comment',
              createdAt: '2026-03-01T00:00:00Z',
            }),
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
      global.fetch = mock(() =>
        Promise.resolve(
          new Response(
            JSON.stringify({
              id: 'comment-1',
              comment: '',
              createdAt: '2026-03-01T00:00:00Z',
            }),
            { status: 200 },
          ),
        ),
      )

      const resource = new CommentResource(mockConfig)
      const result = await resource.add('task-1', '')

      expect(result.comment).toBe('')
    })

    test('handles long comment', async () => {
      const longComment = 'a'.repeat(1000)
      global.fetch = mock(() =>
        Promise.resolve(
          new Response(
            JSON.stringify({
              id: 'comment-1',
              comment: longComment,
              createdAt: '2026-03-01T00:00:00Z',
            }),
            { status: 200 },
          ),
        ),
      )

      const resource = new CommentResource(mockConfig)
      const result = await resource.add('task-1', longComment)

      expect(result.comment).toBe(longComment)
    })

    test('throws taskNotFound for 404', async () => {
      global.fetch = mock(() =>
        Promise.resolve(new Response(JSON.stringify({ error: 'Task not found' }), { status: 404 })),
      )

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
      global.fetch = mock(() =>
        Promise.resolve(
          new Response(
            JSON.stringify([
              { id: 'act-1', type: 'comment', comment: 'Comment 1', message: null, createdAt: '2026-03-01T00:00:00Z' },
              {
                id: 'act-2',
                type: 'status_change',
                comment: null,
                message: 'Status changed',
                createdAt: '2026-03-01T00:00:00Z',
              },
              { id: 'act-3', type: 'comment', comment: 'Comment 2', message: null, createdAt: '2026-03-02T00:00:00Z' },
            ]),
            { status: 200 },
          ),
        ),
      )

      const resource = new CommentResource(mockConfig)
      const result = await resource.list('task-1')

      expect(result).toHaveLength(2)
      expect(result[0].comment).toBe('Comment 1')
      expect(result[1].comment).toBe('Comment 2')
    })

    test('excludes activities with null comment', async () => {
      global.fetch = mock(() =>
        Promise.resolve(
          new Response(
            JSON.stringify([
              {
                id: 'act-1',
                type: 'comment',
                comment: 'Valid comment',
                message: null,
                createdAt: '2026-03-01T00:00:00Z',
              },
              { id: 'act-2', type: 'comment', comment: null, message: null, createdAt: '2026-03-01T00:00:00Z' },
            ]),
            { status: 200 },
          ),
        ),
      )

      const resource = new CommentResource(mockConfig)
      const result = await resource.list('task-1')

      expect(result).toHaveLength(1)
      expect(result[0].comment).toBe('Valid comment')
    })

    test('returns empty array when no comments', async () => {
      global.fetch = mock(() =>
        Promise.resolve(
          new Response(
            JSON.stringify([
              {
                id: 'act-1',
                type: 'status_change',
                comment: null,
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
      global.fetch = mock(() =>
        Promise.resolve(
          new Response(
            JSON.stringify([
              { id: 'act-1', type: 'comment', comment: 'Test', message: null, createdAt: '2026-03-01T12:00:00Z' },
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
      global.fetch = mock(() =>
        Promise.resolve(new Response(JSON.stringify({ error: 'Task not found' }), { status: 404 })),
      )

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
      global.fetch = mock((_url: string, options: RequestInit) => {
        capturedBody = typeof options.body === 'string' ? JSON.parse(options.body) : undefined
        return Promise.resolve(
          new Response(
            JSON.stringify({
              id: 'comment-1',
              comment: 'Updated',
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
    })

    test('throws commentNotFound for 404', async () => {
      global.fetch = mock(() =>
        Promise.resolve(new Response(JSON.stringify({ error: 'Comment not found' }), { status: 404 })),
      )

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
      global.fetch = mock(() => Promise.resolve(new Response(JSON.stringify({ success: true }), { status: 200 })))

      const resource = new CommentResource(mockConfig)
      const result = await resource.remove('comment-1')

      expect(result.id).toBe('comment-1')
      expect(result.success).toBe(true)
    })

    test('throws commentNotFound for 404', async () => {
      global.fetch = mock(() =>
        Promise.resolve(new Response(JSON.stringify({ error: 'Comment not found' }), { status: 404 })),
      )

      const resource = new CommentResource(mockConfig)
      const promise = resource.remove('invalid')
      expect(promise).rejects.toMatchObject({
        appError: { code: 'comment-not-found' },
      })
      await promise.catch(() => {})
    })
  })
})
