import { describe, expect, test, mock, beforeEach } from 'bun:test'

import { makeAddTaskLabelTool } from '../../src/tools/add-task-label.js'
import { makeRemoveTaskLabelTool } from '../../src/tools/remove-task-label.js'
import { getToolExecutor } from '../test-helpers.js'

const mockConfig = { apiKey: 'test-key', baseUrl: 'https://api.test.com' }
const mockWorkspaceId = 'ws-1'

function isTaskLabel(val: unknown): val is { id: string; taskId: string; labelId: string } {
  return (
    val !== null &&
    typeof val === 'object' &&
    'id' in val &&
    typeof val.id === 'string' &&
    'taskId' in val &&
    typeof val.taskId === 'string' &&
    'labelId' in val &&
    typeof val.labelId === 'string'
  )
}

function isSuccessResult(val: unknown): val is { success: boolean } {
  return val !== null && typeof val === 'object' && 'success' in val && typeof val.success === 'boolean'
}

describe('Task Label Tools', () => {
  beforeEach(() => {
    mock.restore()
  })

  describe('makeAddTaskLabelTool', () => {
    test('returns tool with correct structure', () => {
      const tool = makeAddTaskLabelTool(mockConfig, mockWorkspaceId)
      expect(tool.description).toContain('Add a label to a Kaneo task')
    })

    test('adds label to task', async () => {
      await mock.module('../../src/kaneo/index.js', () => ({
        addTaskLabel: mock(() =>
          Promise.resolve({
            id: 'tl-1',
            taskId: 'task-1',
            labelId: 'label-1',
          }),
        ),
      }))

      const tool = makeAddTaskLabelTool(mockConfig, mockWorkspaceId)
      const result: unknown = await tool.execute(
        { taskId: 'task-1', labelId: 'label-1' },
        { toolCallId: '1', messages: [] },
      )
      if (!isTaskLabel(result)) throw new Error('Invalid result')

      expect(result.id).toBe('tl-1')
      expect(result.taskId).toBe('task-1')
      expect(result.labelId).toBe('label-1')
    })

    test('includes workspaceId in add call', async () => {
      let capturedParams: Record<string, unknown> | undefined
      await mock.module('../../src/kaneo/index.js', () => ({
        addTaskLabel: mock((params: Record<string, unknown>) => {
          capturedParams = params
          return Promise.resolve({ id: 'tl-1', taskId: 'task-1', labelId: 'label-1' })
        }),
      }))

      const tool = makeAddTaskLabelTool(mockConfig, 'ws-123')
      await tool.execute({ taskId: 'task-1', labelId: 'label-1' }, { toolCallId: '1', messages: [] })

      expect(capturedParams?.['workspaceId']).toBe('ws-123')
    })

    test('propagates task not found error', async () => {
      await mock.module('../../src/kaneo/index.js', () => ({
        addTaskLabel: mock(() => Promise.reject(new Error('Task not found'))),
      }))

      const tool = makeAddTaskLabelTool(mockConfig, mockWorkspaceId)
      const promise = getToolExecutor(tool)(
        { taskId: 'invalid', labelId: 'label-1' },
        { toolCallId: '1', messages: [] },
      )
      expect(promise).rejects.toThrow('Task not found')
      try {
        await promise
      } catch {
        // ignore
      }
    })

    test('propagates label not found error', async () => {
      await mock.module('../../src/kaneo/index.js', () => ({
        addTaskLabel: mock(() => Promise.reject(new Error('Label not found'))),
      }))

      const tool = makeAddTaskLabelTool(mockConfig, mockWorkspaceId)
      const promise = getToolExecutor(tool)({ taskId: 'task-1', labelId: 'invalid' }, { toolCallId: '1', messages: [] })
      expect(promise).rejects.toThrow('Label not found')
      try {
        await promise
      } catch {
        // ignore
      }
    })

    test('validates taskId is required', async () => {
      const tool = makeAddTaskLabelTool(mockConfig, mockWorkspaceId)
      const promise = getToolExecutor(tool)({ labelId: 'label-1' }, { toolCallId: '1', messages: [] })
      expect(promise).rejects.toThrow()
      try {
        await promise
      } catch {
        // ignore
      }
    })

    test('validates labelId is required', async () => {
      const tool = makeAddTaskLabelTool(mockConfig, mockWorkspaceId)
      const promise = getToolExecutor(tool)({ taskId: 'task-1' }, { toolCallId: '1', messages: [] })
      expect(promise).rejects.toThrow()
      try {
        await promise
      } catch {
        // ignore
      }
    })
  })

  describe('makeRemoveTaskLabelTool', () => {
    test('returns tool with correct structure', () => {
      const tool = makeRemoveTaskLabelTool(mockConfig)
      expect(tool.description).toContain('Remove a label from a Kaneo task')
    })

    test('removes label from task', async () => {
      await mock.module('../../src/kaneo/index.js', () => ({
        removeTaskLabel: mock(() => Promise.resolve({ success: true })),
      }))

      const tool = makeRemoveTaskLabelTool(mockConfig)
      const result: unknown = await tool.execute(
        { taskId: 'task-1', labelId: 'label-1' },
        { toolCallId: '1', messages: [] },
      )
      if (!isSuccessResult(result)) throw new Error('Invalid result')

      expect(result.success).toBe(true)
    })

    test('propagates task not found error', async () => {
      await mock.module('../../src/kaneo/index.js', () => ({
        removeTaskLabel: mock(() => Promise.reject(new Error('Task not found'))),
      }))

      const tool = makeRemoveTaskLabelTool(mockConfig)
      const promise = getToolExecutor(tool)(
        { taskId: 'invalid', labelId: 'label-1' },
        { toolCallId: '1', messages: [] },
      )
      expect(promise).rejects.toThrow('Task not found')
      try {
        await promise
      } catch {
        // ignore
      }
    })

    test('propagates label not found error', async () => {
      await mock.module('../../src/kaneo/index.js', () => ({
        removeTaskLabel: mock(() => Promise.reject(new Error('Label not found'))),
      }))

      const tool = makeRemoveTaskLabelTool(mockConfig)
      const promise = getToolExecutor(tool)({ taskId: 'task-1', labelId: 'invalid' }, { toolCallId: '1', messages: [] })
      expect(promise).rejects.toThrow('Label not found')
      try {
        await promise
      } catch {
        // ignore
      }
    })

    test('validates taskId is required', async () => {
      const tool = makeRemoveTaskLabelTool(mockConfig)
      const promise = getToolExecutor(tool)({ labelId: 'label-1' }, { toolCallId: '1', messages: [] })
      expect(promise).rejects.toThrow()
      try {
        await promise
      } catch {
        // ignore
      }
    })

    test('validates labelId is required', async () => {
      const tool = makeRemoveTaskLabelTool(mockConfig)
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
