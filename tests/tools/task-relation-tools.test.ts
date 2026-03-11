import { describe, expect, test, mock, beforeEach } from 'bun:test'

import { makeAddTaskRelationTool } from '../../src/tools/add-task-relation.js'
import { makeRemoveTaskRelationTool } from '../../src/tools/remove-task-relation.js'
import { makeUpdateTaskRelationTool } from '../../src/tools/update-task-relation.js'
import { getToolExecutor } from '../test-helpers.js'

const mockConfig = { apiKey: 'test-key', baseUrl: 'https://api.test.com' }

function isTaskRelation(val: unknown): val is { taskId: string; relatedTaskId: string; type: string } {
  return (
    val !== null &&
    typeof val === 'object' &&
    'taskId' in val &&
    typeof val.taskId === 'string' &&
    'relatedTaskId' in val &&
    typeof val.relatedTaskId === 'string' &&
    'type' in val &&
    typeof val.type === 'string'
  )
}

function isSuccessResult(val: unknown): val is { success: boolean } {
  return val !== null && typeof val === 'object' && 'success' in val && typeof val.success === 'boolean'
}

describe('Task Relation Tools', () => {
  beforeEach(() => {
    mock.restore()
  })

  describe('makeAddTaskRelationTool', () => {
    test('returns tool with correct structure', () => {
      const tool = makeAddTaskRelationTool(mockConfig)
      expect(tool.description).toContain('Create a relation between two Kaneo tasks')
    })

    test('adds blocks relation', async () => {
      await mock.module('../../src/kaneo/index.js', () => ({
        addTaskRelation: mock(() =>
          Promise.resolve({
            taskId: 'task-1',
            relatedTaskId: 'task-2',
            type: 'blocks',
          }),
        ),
      }))

      const tool = makeAddTaskRelationTool(mockConfig)
      const result: unknown = await tool.execute(
        { taskId: 'task-1', relatedTaskId: 'task-2', type: 'blocks' },
        { toolCallId: '1', messages: [] },
      )
      if (!isTaskRelation(result)) throw new Error('Invalid result')

      expect(result.taskId).toBe('task-1')
      expect(result.relatedTaskId).toBe('task-2')
      expect(result.type).toBe('blocks')
    })

    test('adds duplicate relation', async () => {
      let capturedParams: Record<string, unknown> | undefined
      await mock.module('../../src/kaneo/index.js', () => ({
        addTaskRelation: mock((params: Record<string, unknown>) => {
          capturedParams = params
          return Promise.resolve({
            taskId: String(params.taskId),
            relatedTaskId: String(params.relatedTaskId),
            type: String(params.type),
          })
        }),
      }))

      const tool = makeAddTaskRelationTool(mockConfig)
      await tool.execute(
        { taskId: 'task-1', relatedTaskId: 'task-2', type: 'duplicate' },
        { toolCallId: '1', messages: [] },
      )

      expect(capturedParams?.['type']).toBe('duplicate')
    })

    test('adds related relation', async () => {
      let capturedParams: Record<string, unknown> | undefined
      await mock.module('../../src/kaneo/index.js', () => ({
        addTaskRelation: mock((params: Record<string, unknown>) => {
          capturedParams = params
          return Promise.resolve({
            taskId: String(params.taskId),
            relatedTaskId: String(params.relatedTaskId),
            type: String(params.type),
          })
        }),
      }))

      const tool = makeAddTaskRelationTool(mockConfig)
      await tool.execute(
        { taskId: 'task-1', relatedTaskId: 'task-2', type: 'related' },
        { toolCallId: '1', messages: [] },
      )

      expect(capturedParams?.['type']).toBe('related')
    })

    test('adds parent relation', async () => {
      let capturedParams: Record<string, unknown> | undefined
      await mock.module('../../src/kaneo/index.js', () => ({
        addTaskRelation: mock((params: Record<string, unknown>) => {
          capturedParams = params
          return Promise.resolve({
            taskId: String(params.taskId),
            relatedTaskId: String(params.relatedTaskId),
            type: String(params.type),
          })
        }),
      }))

      const tool = makeAddTaskRelationTool(mockConfig)
      await tool.execute(
        { taskId: 'task-1', relatedTaskId: 'task-2', type: 'parent' },
        { toolCallId: '1', messages: [] },
      )

      expect(capturedParams?.['type']).toBe('parent')
    })

    test('propagates task not found error', async () => {
      await mock.module('../../src/kaneo/index.js', () => ({
        addTaskRelation: mock(() => Promise.reject(new Error('Task not found'))),
      }))

      const tool = makeAddTaskRelationTool(mockConfig)
      const promise = getToolExecutor(tool)(
        { taskId: 'invalid', relatedTaskId: 'task-2', type: 'blocks' },
        { toolCallId: '1', messages: [] },
      )
      expect(promise).rejects.toThrow('Task not found')
      try {
        await promise
      } catch {
        // ignore
      }
    })

    test('validates taskId is required', async () => {
      const tool = makeAddTaskRelationTool(mockConfig)
      const promise = getToolExecutor(tool)(
        { relatedTaskId: 'task-2', type: 'blocks' },
        { toolCallId: '1', messages: [] },
      )
      expect(promise).rejects.toThrow()
      try {
        await promise
      } catch {
        // ignore
      }
    })

    test('validates relatedTaskId is required', async () => {
      const tool = makeAddTaskRelationTool(mockConfig)
      const promise = getToolExecutor(tool)({ taskId: 'task-1', type: 'blocks' }, { toolCallId: '1', messages: [] })
      expect(promise).rejects.toThrow()
      try {
        await promise
      } catch {
        // ignore
      }
    })

    test('validates type is required', async () => {
      const tool = makeAddTaskRelationTool(mockConfig)
      const promise = getToolExecutor(tool)(
        { taskId: 'task-1', relatedTaskId: 'task-2' },
        { toolCallId: '1', messages: [] },
      )
      expect(promise).rejects.toThrow()
      try {
        await promise
      } catch {
        // ignore
      }
    })

    test('validates type is from allowed enum', async () => {
      const tool = makeAddTaskRelationTool(mockConfig)
      const promise = getToolExecutor(tool)(
        { taskId: 'task-1', relatedTaskId: 'task-2', type: 'invalid' as unknown },
        { toolCallId: '1', messages: [] },
      )
      expect(promise).rejects.toThrow()
      try {
        await promise
      } catch {
        // ignore
      }
    })
  })

  describe('makeUpdateTaskRelationTool', () => {
    test('returns tool with correct structure', () => {
      const tool = makeUpdateTaskRelationTool(mockConfig)
      expect(tool.description).toContain('Update the type of an existing relation')
    })

    test('updates relation type from blocks to related', async () => {
      await mock.module('../../src/kaneo/index.js', () => ({
        updateTaskRelation: mock(() =>
          Promise.resolve({
            taskId: 'task-1',
            relatedTaskId: 'task-2',
            type: 'related',
          }),
        ),
      }))

      const tool = makeUpdateTaskRelationTool(mockConfig)
      const result: unknown = await tool.execute(
        { taskId: 'task-1', relatedTaskId: 'task-2', type: 'related' },
        { toolCallId: '1', messages: [] },
      )
      if (!isTaskRelation(result)) throw new Error('Invalid result')

      expect(result.taskId).toBe('task-1')
      expect(result.relatedTaskId).toBe('task-2')
      expect(result.type).toBe('related')
    })

    test('updates relation type to duplicate', async () => {
      let capturedParams: Record<string, unknown> | undefined
      await mock.module('../../src/kaneo/index.js', () => ({
        updateTaskRelation: mock((params: Record<string, unknown>) => {
          capturedParams = params
          return Promise.resolve({
            taskId: String(params.taskId),
            relatedTaskId: String(params.relatedTaskId),
            type: String(params.type),
          })
        }),
      }))

      const tool = makeUpdateTaskRelationTool(mockConfig)
      await tool.execute(
        { taskId: 'task-1', relatedTaskId: 'task-2', type: 'duplicate' },
        { toolCallId: '1', messages: [] },
      )

      expect(capturedParams?.['type']).toBe('duplicate')
    })

    test('updates relation type to parent', async () => {
      let capturedParams: Record<string, unknown> | undefined
      await mock.module('../../src/kaneo/index.js', () => ({
        updateTaskRelation: mock((params: Record<string, unknown>) => {
          capturedParams = params
          return Promise.resolve({
            taskId: String(params.taskId),
            relatedTaskId: String(params.relatedTaskId),
            type: String(params.type),
          })
        }),
      }))

      const tool = makeUpdateTaskRelationTool(mockConfig)
      await tool.execute(
        { taskId: 'task-1', relatedTaskId: 'task-2', type: 'parent' },
        { toolCallId: '1', messages: [] },
      )

      expect(capturedParams?.['type']).toBe('parent')
    })

    test('propagates relation not found error', async () => {
      await mock.module('../../src/kaneo/index.js', () => ({
        updateTaskRelation: mock(() => Promise.reject(new Error('Relation not found'))),
      }))

      const tool = makeUpdateTaskRelationTool(mockConfig)
      const promise = getToolExecutor(tool)(
        { taskId: 'task-1', relatedTaskId: 'invalid', type: 'blocks' },
        { toolCallId: '1', messages: [] },
      )
      expect(promise).rejects.toThrow('Relation not found')
      try {
        await promise
      } catch {
        // ignore
      }
    })

    test('validates taskId is required', async () => {
      const tool = makeUpdateTaskRelationTool(mockConfig)
      const promise = getToolExecutor(tool)(
        { relatedTaskId: 'task-2', type: 'blocks' },
        { toolCallId: '1', messages: [] },
      )
      expect(promise).rejects.toThrow()
      try {
        await promise
      } catch {
        // ignore
      }
    })

    test('validates relatedTaskId is required', async () => {
      const tool = makeUpdateTaskRelationTool(mockConfig)
      const promise = getToolExecutor(tool)({ taskId: 'task-1', type: 'blocks' }, { toolCallId: '1', messages: [] })
      expect(promise).rejects.toThrow()
      try {
        await promise
      } catch {
        // ignore
      }
    })

    test('validates type is required', async () => {
      const tool = makeUpdateTaskRelationTool(mockConfig)
      const promise = getToolExecutor(tool)(
        { taskId: 'task-1', relatedTaskId: 'task-2' },
        { toolCallId: '1', messages: [] },
      )
      expect(promise).rejects.toThrow()
      try {
        await promise
      } catch {
        // ignore
      }
    })
  })

  describe('makeRemoveTaskRelationTool', () => {
    test('returns tool with correct structure', () => {
      const tool = makeRemoveTaskRelationTool(mockConfig)
      expect(tool.description).toContain('Remove a relation between two Kaneo tasks')
    })

    test('removes relation successfully', async () => {
      await mock.module('../../src/kaneo/index.js', () => ({
        removeTaskRelation: mock(() => Promise.resolve({ success: true })),
      }))

      const tool = makeRemoveTaskRelationTool(mockConfig)
      const result: unknown = await tool.execute(
        { taskId: 'task-1', relatedTaskId: 'task-2' },
        { toolCallId: '1', messages: [] },
      )
      if (!isSuccessResult(result)) throw new Error('Invalid result')

      expect(result.success).toBe(true)
    })

    test('propagates task not found error', async () => {
      await mock.module('../../src/kaneo/index.js', () => ({
        removeTaskRelation: mock(() => Promise.reject(new Error('Task not found'))),
      }))

      const tool = makeRemoveTaskRelationTool(mockConfig)
      const promise = getToolExecutor(tool)(
        { taskId: 'invalid', relatedTaskId: 'task-2' },
        { toolCallId: '1', messages: [] },
      )
      expect(promise).rejects.toThrow('Task not found')
      try {
        await promise
      } catch {
        // ignore
      }
    })

    test('propagates relation not found error', async () => {
      await mock.module('../../src/kaneo/index.js', () => ({
        removeTaskRelation: mock(() => Promise.reject(new Error('Relation not found'))),
      }))

      const tool = makeRemoveTaskRelationTool(mockConfig)
      const promise = getToolExecutor(tool)(
        { taskId: 'task-1', relatedTaskId: 'invalid' },
        { toolCallId: '1', messages: [] },
      )
      expect(promise).rejects.toThrow('Relation not found')
      try {
        await promise
      } catch {
        // ignore
      }
    })

    test('validates taskId is required', async () => {
      const tool = makeRemoveTaskRelationTool(mockConfig)
      const promise = getToolExecutor(tool)({ relatedTaskId: 'task-2' }, { toolCallId: '1', messages: [] })
      expect(promise).rejects.toThrow()
      try {
        await promise
      } catch {
        // ignore
      }
    })

    test('validates relatedTaskId is required', async () => {
      const tool = makeRemoveTaskRelationTool(mockConfig)
      const promise = getToolExecutor(tool)({ taskId: 'task-1' }, { toolCallId: '1', messages: [] })
      expect(promise).rejects.toThrow()
      try {
        await promise
      } catch {
        // ignore
      }
    })
  })
})
