import { describe, expect, test, mock, beforeEach } from 'bun:test'

import { makeAddTaskLabelTool } from '../../src/tools/add-task-label.js'
import { makeRemoveTaskLabelTool } from '../../src/tools/remove-task-label.js'
import { getToolExecutor, schemaValidates } from '../test-helpers.js'
import { mockLogger } from '../utils/test-helpers.js'
import { createMockProvider } from './mock-provider.js'

function isTaskLabel(val: unknown): val is { taskId: string; labelId: string } {
  return (
    val !== null &&
    typeof val === 'object' &&
    'taskId' in val &&
    typeof val.taskId === 'string' &&
    'labelId' in val &&
    typeof val.labelId === 'string'
  )
}

describe('Task Label Tools', () => {
  beforeEach(() => {
    mockLogger()
    mock.restore()
  })

  describe('makeAddTaskLabelTool', () => {
    test('returns tool with correct structure', () => {
      const provider = createMockProvider()
      const tool = makeAddTaskLabelTool(provider)
      expect(tool.description).toContain('Add a label to a task')
    })

    test('adds label to task', async () => {
      const provider = createMockProvider({
        addTaskLabel: mock(() =>
          Promise.resolve({
            taskId: 'task-1',
            labelId: 'label-1',
          }),
        ),
      })

      const tool = makeAddTaskLabelTool(provider)
      if (!tool.execute) throw new Error('Tool execute is undefined')
      const result: unknown = await tool.execute(
        { taskId: 'task-1', labelId: 'label-1' },
        { toolCallId: '1', messages: [] },
      )
      if (!isTaskLabel(result)) throw new Error('Invalid result')

      expect(result.taskId).toBe('task-1')
      expect(result.labelId).toBe('label-1')
    })

    test('calls provider addTaskLabel with correct params', async () => {
      const addTaskLabel = mock(() => Promise.resolve({ taskId: 'task-1', labelId: 'label-1' }))
      const provider = createMockProvider({ addTaskLabel })

      const tool = makeAddTaskLabelTool(provider)
      if (!tool.execute) throw new Error('Tool execute is undefined')
      await tool.execute({ taskId: 'task-1', labelId: 'label-1' }, { toolCallId: '1', messages: [] })

      expect(addTaskLabel).toHaveBeenCalledTimes(1)
      expect(addTaskLabel).toHaveBeenCalledWith('task-1', 'label-1')
    })

    test('propagates task not found error', async () => {
      const provider = createMockProvider({
        addTaskLabel: mock(() => Promise.reject(new Error('Task not found'))),
      })

      const tool = makeAddTaskLabelTool(provider)
      const promise = getToolExecutor(tool)(
        { taskId: 'invalid', labelId: 'label-1' },
        { toolCallId: '1', messages: [] },
      )
      await expect(promise).rejects.toThrow('Task not found')
      try {
        await promise
      } catch {
        // ignore
      }
    })

    test('propagates label not found error', async () => {
      const provider = createMockProvider({
        addTaskLabel: mock(() => Promise.reject(new Error('Label not found'))),
      })

      const tool = makeAddTaskLabelTool(provider)
      const promise = getToolExecutor(tool)({ taskId: 'task-1', labelId: 'invalid' }, { toolCallId: '1', messages: [] })
      await expect(promise).rejects.toThrow('Label not found')
      try {
        await promise
      } catch {
        // ignore
      }
    })

    test('validates taskId is required', () => {
      const provider = createMockProvider()
      const tool = makeAddTaskLabelTool(provider)
      expect(schemaValidates(tool, { labelId: 'label-1' })).toBe(false)
    })

    test('validates labelId is required', () => {
      const provider = createMockProvider()
      const tool = makeAddTaskLabelTool(provider)
      expect(schemaValidates(tool, { taskId: 'task-1' })).toBe(false)
    })

    test('adding label already present on task — document behavior', async () => {
      const addTaskLabel = mock(() => Promise.resolve({ taskId: 'task-1', labelId: 'label-1' }))
      const provider = createMockProvider({ addTaskLabel })

      const tool = makeAddTaskLabelTool(provider)
      if (!tool.execute) throw new Error('Tool execute is undefined')
      const result: unknown = await tool.execute(
        { taskId: 'task-1', labelId: 'label-1' },
        { toolCallId: '1', messages: [] },
      )
      if (!isTaskLabel(result)) throw new Error('Invalid result')

      expect(result.taskId).toBe('task-1')
      expect(result.labelId).toBe('label-1')
      expect(addTaskLabel).toHaveBeenCalledWith('task-1', 'label-1')
    })
  })

  describe('makeRemoveTaskLabelTool', () => {
    test('returns tool with correct structure', () => {
      const provider = createMockProvider()
      const tool = makeRemoveTaskLabelTool(provider)
      expect(tool.description).toContain('Remove a label from a task')
    })

    test('removes label from task', async () => {
      const provider = createMockProvider({
        removeTaskLabel: mock(() => Promise.resolve({ taskId: 'task-1', labelId: 'label-1' })),
      })

      const tool = makeRemoveTaskLabelTool(provider)
      if (!tool.execute) throw new Error('Tool execute is undefined')
      const result: unknown = await tool.execute(
        { taskId: 'task-1', labelId: 'label-1' },
        { toolCallId: '1', messages: [] },
      )
      if (!isTaskLabel(result)) throw new Error('Invalid result')

      expect(result.taskId).toBe('task-1')
      expect(result.labelId).toBe('label-1')
    })

    test('calls provider removeTaskLabel with correct params', async () => {
      const removeTaskLabel = mock(() => Promise.resolve({ taskId: 'task-1', labelId: 'label-1' }))
      const provider = createMockProvider({ removeTaskLabel })

      const tool = makeRemoveTaskLabelTool(provider)
      if (!tool.execute) throw new Error('Tool execute is undefined')
      await tool.execute({ taskId: 'task-1', labelId: 'label-1' }, { toolCallId: '1', messages: [] })

      expect(removeTaskLabel).toHaveBeenCalledTimes(1)
      expect(removeTaskLabel).toHaveBeenCalledWith('task-1', 'label-1')
    })

    test('propagates task not found error', async () => {
      const provider = createMockProvider({
        removeTaskLabel: mock(() => Promise.reject(new Error('Task not found'))),
      })

      const tool = makeRemoveTaskLabelTool(provider)
      const promise = getToolExecutor(tool)(
        { taskId: 'invalid', labelId: 'label-1' },
        { toolCallId: '1', messages: [] },
      )
      await expect(promise).rejects.toThrow('Task not found')
      try {
        await promise
      } catch {
        // ignore
      }
    })

    test('propagates label not found error', async () => {
      const provider = createMockProvider({
        removeTaskLabel: mock(() => Promise.reject(new Error('Label not found'))),
      })

      const tool = makeRemoveTaskLabelTool(provider)
      const promise = getToolExecutor(tool)({ taskId: 'task-1', labelId: 'invalid' }, { toolCallId: '1', messages: [] })
      await expect(promise).rejects.toThrow('Label not found')
      try {
        await promise
      } catch {
        // ignore
      }
    })

    test('validates taskId is required', () => {
      const provider = createMockProvider()
      const tool = makeRemoveTaskLabelTool(provider)
      expect(schemaValidates(tool, { labelId: 'label-1' })).toBe(false)
    })

    test('validates labelId is required', () => {
      const provider = createMockProvider()
      const tool = makeRemoveTaskLabelTool(provider)
      expect(schemaValidates(tool, { taskId: 'task-1' })).toBe(false)
    })
  })
})
