import { describe, expect, test, mock, beforeEach } from 'bun:test'

import { makeAddCommentTool } from '../../src/tools/add-comment.js'
import { makeGetCommentsTool } from '../../src/tools/get-comments.js'
import { makeRemoveCommentTool } from '../../src/tools/remove-comment.js'
import { makeUpdateCommentTool } from '../../src/tools/update-comment.js'
import { getToolExecutor } from '../test-helpers.js'

const mockConfig = { apiKey: 'test-key', baseUrl: 'https://api.test.com' }

function isComment(val: unknown): val is { id: string; comment: string; createdAt: string } {
  return (
    val !== null &&
    typeof val === 'object' &&
    'id' in val &&
    typeof val.id === 'string' &&
    'comment' in val &&
    typeof val.comment === 'string' &&
    'createdAt' in val &&
    typeof val.createdAt === 'string'
  )
}

function isSuccessResult(val: unknown): val is { success: boolean } {
  return val !== null && typeof val === 'object' && 'success' in val && typeof val.success === 'boolean'
}

describe('Comment Tools', () => {
  beforeEach(() => {
    mock.restore()
  })

  describe('makeAddCommentTool', () => {
    test('returns tool with correct structure', () => {
      const tool = makeAddCommentTool(mockConfig)
      expect(tool.description).toContain('Add a comment')
    })

    test('adds comment to task', async () => {
      await mock.module('../../src/kaneo/index.js', () => ({
        addComment: mock(() =>
          Promise.resolve({
            id: 'comment-1',
            comment: 'New comment',
            createdAt: '2026-03-01T00:00:00Z',
          }),
        ),
      }))

      const tool = makeAddCommentTool(mockConfig)
      if (!tool.execute) throw new Error('Tool execute is undefined')
      const result: unknown = await tool.execute(
        { taskId: 'task-1', comment: 'New comment' },
        { toolCallId: '1', messages: [] },
      )
      if (!isComment(result)) throw new Error('Invalid result')

      expect(result.id).toBe('comment-1')
      expect(result.comment).toBe('New comment')
    })

    test('handles empty comment', async () => {
      await mock.module('../../src/kaneo/index.js', () => ({
        addComment: mock(() =>
          Promise.resolve({
            id: 'comment-1',
            comment: '',
            createdAt: '2026-03-01T00:00:00Z',
          }),
        ),
      }))

      const tool = makeAddCommentTool(mockConfig)
      if (!tool.execute) throw new Error('Tool execute is undefined')
      const result: unknown = await tool.execute({ taskId: 'task-1', comment: '' }, { toolCallId: '1', messages: [] })
      if (!isComment(result)) throw new Error('Invalid result')

      expect(result.comment).toBe('')
    })

    test('handles very long comment', async () => {
      const longComment = 'a'.repeat(1000)
      await mock.module('../../src/kaneo/index.js', () => ({
        addComment: mock(() =>
          Promise.resolve({
            id: 'comment-1',
            comment: longComment,
            createdAt: '2026-03-01T00:00:00Z',
          }),
        ),
      }))

      const tool = makeAddCommentTool(mockConfig)
      if (!tool.execute) throw new Error('Tool execute is undefined')
      const result: unknown = await tool.execute(
        { taskId: 'task-1', comment: longComment },
        { toolCallId: '1', messages: [] },
      )
      if (!isComment(result)) throw new Error('Invalid result')

      expect(result.comment).toBe(longComment)
    })

    test('propagates task not found error', async () => {
      await mock.module('../../src/kaneo/index.js', () => ({
        addComment: mock(() => Promise.reject(new Error('Task not found'))),
      }))

      const tool = makeAddCommentTool(mockConfig)
      const promise = getToolExecutor(tool)({ taskId: 'invalid', comment: 'Test' }, { toolCallId: '1', messages: [] })
      expect(promise).rejects.toThrow('Task not found')
      try {
        await promise
      } catch {
        /* ignore */
      }
    })

    test('validates taskId is required', async () => {
      const tool = makeAddCommentTool(mockConfig)
      const promise = getToolExecutor(tool)({ comment: 'Test' }, { toolCallId: '1', messages: [] })
      expect(promise).rejects.toThrow()
      try {
        await promise
      } catch {
        /* ignore */
      }
    })

    test('validates comment is required', async () => {
      const tool = makeAddCommentTool(mockConfig)
      const promise = getToolExecutor(tool)({ taskId: 'task-1' }, { toolCallId: '1', messages: [] })
      expect(promise).rejects.toThrow()
      try {
        await promise
      } catch {
        /* ignore */
      }
    })
  })

  describe('makeGetCommentsTool', () => {
    test('returns tool with correct structure', () => {
      const tool = makeGetCommentsTool(mockConfig)
      expect(tool.description).toContain('Get all comments')
    })

    test('gets all comments on task', async () => {
      await mock.module('../../src/kaneo/index.js', () => ({
        getComments: mock(() =>
          Promise.resolve([
            { id: 'comment-1', comment: 'Comment 1', createdAt: '2026-03-01T00:00:00Z' },
            { id: 'comment-2', comment: 'Comment 2', createdAt: '2026-03-02T00:00:00Z' },
          ]),
        ),
      }))

      const tool = makeGetCommentsTool(mockConfig)
      if (!tool.execute) throw new Error('Tool execute is undefined')
      const result: unknown = await tool.execute({ taskId: 'task-1' }, { toolCallId: '1', messages: [] })
      if (!Array.isArray(result)) throw new Error('Invalid result')

      expect(result).toHaveLength(2)
    })

    test('filters non-comment activities', async () => {
      await mock.module('../../src/kaneo/index.js', () => ({
        getComments: mock(() =>
          Promise.resolve([{ id: 'act-1', comment: 'Comment 1', createdAt: '2026-03-01T00:00:00Z' }]),
        ),
      }))

      const tool = makeGetCommentsTool(mockConfig)
      if (!tool.execute) throw new Error('Tool execute is undefined')
      const result: unknown = await tool.execute({ taskId: 'task-1' }, { toolCallId: '1', messages: [] })
      if (!Array.isArray(result)) throw new Error('Invalid result')

      expect(result).toHaveLength(1)
    })

    test('propagates task not found error', async () => {
      await mock.module('../../src/kaneo/index.js', () => ({
        getComments: mock(() => Promise.reject(new Error('Task not found'))),
      }))

      const tool = makeGetCommentsTool(mockConfig)
      const promise = getToolExecutor(tool)({ taskId: 'invalid' }, { toolCallId: '1', messages: [] })
      expect(promise).rejects.toThrow('Task not found')
      try {
        await promise
      } catch {
        /* ignore */
      }
    })

    test('validates taskId is required', async () => {
      const tool = makeGetCommentsTool(mockConfig)
      const promise = getToolExecutor(tool)({}, { toolCallId: '1', messages: [] })
      expect(promise).rejects.toThrow()
      try {
        await promise
      } catch {
        /* ignore */
      }
    })
  })

  describe('makeUpdateCommentTool', () => {
    test('returns tool with correct structure', () => {
      const tool = makeUpdateCommentTool(mockConfig)
      expect(tool.description).toContain('Update an existing comment')
    })

    test('updates existing comment', async () => {
      await mock.module('../../src/kaneo/index.js', () => ({
        updateComment: mock(() =>
          Promise.resolve({
            id: 'comment-1',
            comment: 'Updated comment',
            createdAt: '2026-03-01T00:00:00Z',
          }),
        ),
      }))

      const tool = makeUpdateCommentTool(mockConfig)
      if (!tool.execute) throw new Error('Tool execute is undefined')
      const result: unknown = await tool.execute(
        { activityId: 'comment-1', comment: 'Updated comment' },
        { toolCallId: '1', messages: [] },
      )
      if (!isComment(result)) throw new Error('Invalid result')

      expect(result.id).toBe('comment-1')
      expect(result.comment).toBe('Updated comment')
    })

    test('propagates comment not found error', async () => {
      await mock.module('../../src/kaneo/index.js', () => ({
        updateComment: mock(() => Promise.reject(new Error('Comment not found'))),
      }))

      const tool = makeUpdateCommentTool(mockConfig)
      const promise = getToolExecutor(tool)(
        { activityId: 'invalid', comment: 'Test' },
        { toolCallId: '1', messages: [] },
      )
      expect(promise).rejects.toThrow('Comment not found')
      try {
        await promise
      } catch {
        /* ignore */
      }
    })

    test('validates activityId is required', async () => {
      const tool = makeUpdateCommentTool(mockConfig)
      const promise = getToolExecutor(tool)({ comment: 'Test' }, { toolCallId: '1', messages: [] })
      expect(promise).rejects.toThrow()
      try {
        await promise
      } catch {
        /* ignore */
      }
    })

    test('validates comment is required', async () => {
      const tool = makeUpdateCommentTool(mockConfig)
      const promise = getToolExecutor(tool)({ activityId: 'comment-1' }, { toolCallId: '1', messages: [] })
      expect(promise).rejects.toThrow()
      try {
        await promise
      } catch {
        /* ignore */
      }
    })
  })

  describe('makeRemoveCommentTool', () => {
    test('returns tool with correct structure', () => {
      const tool = makeRemoveCommentTool(mockConfig)
      expect(tool.description).toContain('Remove a comment')
    })

    test('removes comment successfully', async () => {
      await mock.module('../../src/kaneo/index.js', () => ({
        removeComment: mock(() => Promise.resolve({ success: true })),
      }))

      const tool = makeRemoveCommentTool(mockConfig)
      if (!tool.execute) throw new Error('Tool execute is undefined')
      const result: unknown = await tool.execute({ activityId: 'comment-1' }, { toolCallId: '1', messages: [] })
      if (!isSuccessResult(result)) throw new Error('Invalid result')

      expect(result.success).toBe(true)
    })

    test('propagates comment not found error', async () => {
      await mock.module('../../src/kaneo/index.js', () => ({
        removeComment: mock(() => Promise.reject(new Error('Comment not found'))),
      }))

      const tool = makeRemoveCommentTool(mockConfig)
      const promise = getToolExecutor(tool)({ activityId: 'invalid' }, { toolCallId: '1', messages: [] })
      expect(promise).rejects.toThrow('Comment not found')
      try {
        await promise
      } catch {
        /* ignore */
      }
    })

    test('validates activityId is required', async () => {
      const tool = makeRemoveCommentTool(mockConfig)
      const promise = getToolExecutor(tool)({}, { toolCallId: '1', messages: [] })
      expect(promise).rejects.toThrow()
      try {
        await promise
      } catch {
        /* ignore */
      }
    })
  })
})
