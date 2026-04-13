import { describe, expect, test, mock, beforeEach, afterAll } from 'bun:test'

import { getConfig, setConfig } from '../../src/config.js'
import { makeGetTaskTool } from '../../src/tools/get-task.js'
import { mockLogger, setupTestDb } from '../utils/test-helpers.js'
import { createMockProvider } from './mock-provider.js'

describe('get_task', () => {
  beforeEach(async () => {
    mockLogger()
    await setupTestDb()
  })

  afterAll(() => {
    mock.restore()
  })

  test('should fetch task details', async () => {
    const getTask = mock((_taskId: string) => {
      return Promise.resolve({
        id: 'task-1',
        title: 'Test Task',
        status: 'todo',
        dueDate: '2024-06-15T12:00:00Z',
        url: 'https://test.com/task/1',
      })
    })

    const provider = createMockProvider({ getTask })
    const tool = makeGetTaskTool(provider, 'user-123')

    if (!tool.execute) throw new Error('Tool execute is undefined')
    const result: unknown = await tool.execute({ taskId: 'task-1' }, { toolCallId: '1', messages: [] })

    expect(getTask).toHaveBeenCalledTimes(1)
    expect(getTask).toHaveBeenCalledWith('task-1')
    expect(result).toHaveProperty('id', 'task-1')
    expect(result).toHaveProperty('title', 'Test Task')
  })

  describe('timezone config lookup (NI2 fix)', () => {
    test('should use storageContextId for timezone in group chats', async () => {
      const chatUserId = 'user-123'
      const storageContextId = 'group-456'
      setConfig(storageContextId, 'timezone', 'Europe/London')

      expect(getConfig(chatUserId, 'timezone')).toBeNull()

      const getTask = mock((_taskId: string) => {
        return Promise.resolve({
          id: 'task-1',
          title: 'Test Task',
          status: 'todo',
          dueDate: '2024-06-15T12:00:00Z',
          url: 'https://test.com/task/1',
        })
      })

      const provider = createMockProvider({ getTask })
      const tool = makeGetTaskTool(provider, chatUserId, storageContextId)

      if (!tool.execute) throw new Error('Tool execute is undefined')
      const result: unknown = await tool.execute({ taskId: 'task-1' }, { toolCallId: '1', messages: [] })

      if (typeof result !== 'object' || result === null) throw new Error('Expected object')
      if (!('dueDate' in result)) throw new Error('Missing dueDate')
      const dueDate = result['dueDate']
      expect(typeof dueDate).toBe('string')
      expect(dueDate).toContain('13:00')
    })

    test('should fallback to UTC when no timezone configured', async () => {
      const chatUserId = 'user-123'
      const storageContextId = 'group-456'

      const getTask = mock((_taskId: string) => {
        return Promise.resolve({
          id: 'task-1',
          title: 'Test Task',
          status: 'todo',
          dueDate: '2024-06-15T12:00:00Z',
          url: 'https://test.com/task/1',
        })
      })

      const provider = createMockProvider({ getTask })
      const tool = makeGetTaskTool(provider, chatUserId, storageContextId)

      if (!tool.execute) throw new Error('Tool execute is undefined')
      const result: unknown = await tool.execute({ taskId: 'task-1' }, { toolCallId: '1', messages: [] })

      if (typeof result !== 'object' || result === null) throw new Error('Expected object')
      if (!('dueDate' in result)) throw new Error('Missing dueDate')
      const dueDate = result['dueDate']
      expect(typeof dueDate).toBe('string')
      expect(dueDate).toContain('12:00')
    })

    test('should work with same userId and storageContextId in DMs', async () => {
      const userId = 'user-123'
      setConfig(userId, 'timezone', 'America/Los_Angeles')

      const getTask = mock((_taskId: string) => {
        return Promise.resolve({
          id: 'task-1',
          title: 'Test Task',
          status: 'todo',
          dueDate: '2024-06-15T21:00:00Z',
          url: 'https://test.com/task/1',
        })
      })

      const provider = createMockProvider({ getTask })
      const tool = makeGetTaskTool(provider, userId, userId)

      if (!tool.execute) throw new Error('Tool execute is undefined')
      const result: unknown = await tool.execute({ taskId: 'task-1' }, { toolCallId: '1', messages: [] })

      if (typeof result !== 'object' || result === null) throw new Error('Expected object')
      if (!('dueDate' in result)) throw new Error('Missing dueDate')
      const dueDate = result['dueDate']
      expect(typeof dueDate).toBe('string')
      expect(dueDate).toContain('14:00')
    })
  })
})
