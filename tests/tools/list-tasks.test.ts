import { describe, expect, test, mock, beforeEach, afterAll } from 'bun:test'

import { getConfig, setConfig } from '../../src/config.js'
import { setIdentityMapping, clearIdentityMapping } from '../../src/identity/mapping.js'
import { makeListTasksTool } from '../../src/tools/list-tasks.js'
import { mockLogger, setupTestDb } from '../utils/test-helpers.js'
import { createMockProvider } from './mock-provider.js'

function hasDueDate(val: unknown): val is { dueDate: string } {
  return (
    typeof val === 'object' &&
    val !== null &&
    'dueDate' in val &&
    typeof (val as Record<string, unknown>)['dueDate'] === 'string'
  )
}

describe('list_tasks identity resolution', () => {
  const testUserId = 'test-list-identity'

  beforeEach(async () => {
    mockLogger()
    await setupTestDb()
    clearIdentityMapping(testUserId, 'mock')
  })

  afterAll(() => {
    mock.restore()
  })

  test('should resolve "me" assigneeId to identity', async () => {
    setIdentityMapping({
      contextId: testUserId,
      providerName: 'mock',
      providerUserId: 'resolved-user-789',
      providerUserLogin: 'jsmith',
      displayName: 'John Smith',
      matchMethod: 'manual_nl',
      confidence: 100,
    })

    let capturedAssigneeId: string | undefined
    const listTasks = mock((_projectId: string, params?: { assigneeId?: string }) => {
      capturedAssigneeId = params?.assigneeId
      return Promise.resolve([
        {
          id: 'task-1',
          title: 'Test Task',
          status: 'todo',
          url: 'https://test.com/task/1',
        },
      ])
    })

    const provider = createMockProvider({ listTasks })
    const tool = makeListTasksTool(provider, testUserId)

    if (!tool.execute) throw new Error('Tool execute is undefined')
    await tool.execute({ projectId: 'proj-1', assigneeId: 'me' }, { toolCallId: '1', messages: [] })

    expect(listTasks).toHaveBeenCalledTimes(1)
    expect(capturedAssigneeId).toBe('resolved-user-789')
  })

  test('should resolve "ME" (uppercase) assigneeId to identity', async () => {
    setIdentityMapping({
      contextId: testUserId,
      providerName: 'mock',
      providerUserId: 'resolved-user-789',
      providerUserLogin: 'jsmith',
      displayName: 'John Smith',
      matchMethod: 'manual_nl',
      confidence: 100,
    })

    let capturedAssigneeId: string | undefined
    const listTasks = mock((_projectId: string, params?: { assigneeId?: string }) => {
      capturedAssigneeId = params?.assigneeId
      return Promise.resolve([
        {
          id: 'task-1',
          title: 'Test Task',
          status: 'todo',
          url: 'https://test.com/task/1',
        },
      ])
    })

    const provider = createMockProvider({ listTasks })
    const tool = makeListTasksTool(provider, testUserId)

    if (!tool.execute) throw new Error('Tool execute is undefined')
    await tool.execute({ projectId: 'proj-1', assigneeId: 'ME' }, { toolCallId: '1', messages: [] })

    expect(listTasks).toHaveBeenCalledTimes(1)
    expect(capturedAssigneeId).toBe('resolved-user-789')
  })

  test('should return identity_required when no mapping exists', async () => {
    const provider = createMockProvider()
    const tool = makeListTasksTool(provider, 'no-mapping-user')

    if (!tool.execute) throw new Error('Tool execute is undefined')
    const result: unknown = await tool.execute(
      { projectId: 'proj-1', assigneeId: 'me' },
      { toolCallId: '1', messages: [] },
    )

    expect(result).toHaveProperty('status', 'identity_required')
    expect(result).toHaveProperty('message')
    if (typeof result === 'object' && result !== null && 'message' in result) {
      expect(result.message).toContain("don't know who you are")
    }
  })

  test('should return identity_required when identity was previously unmatched', async () => {
    setIdentityMapping({
      contextId: 'unmatched-user',
      providerName: 'mock',
      providerUserId: '',
      providerUserLogin: '',
      displayName: '',
      matchMethod: 'unmatched',
      confidence: 0,
    })
    clearIdentityMapping('unmatched-user', 'mock')

    const provider = createMockProvider()
    const tool = makeListTasksTool(provider, 'unmatched-user')

    if (!tool.execute) throw new Error('Tool execute is undefined')
    const result: unknown = await tool.execute(
      { projectId: 'proj-1', assigneeId: 'me' },
      { toolCallId: '1', messages: [] },
    )

    expect(result).toHaveProperty('status', 'identity_required')
    expect(result).toHaveProperty('message')
    if (typeof result === 'object' && result !== null && 'message' in result) {
      expect(result.message).toContain("couldn't automatically match")
    }
  })

  test('should pass through non-me assigneeId unchanged', async () => {
    let capturedAssigneeId: string | undefined
    const listTasks = mock((_projectId: string, params?: { assigneeId?: string }) => {
      capturedAssigneeId = params?.assigneeId
      return Promise.resolve([
        {
          id: 'task-1',
          title: 'Test Task',
          status: 'todo',
          url: 'https://test.com/task/1',
        },
      ])
    })

    const provider = createMockProvider({ listTasks })
    const tool = makeListTasksTool(provider, testUserId)

    if (!tool.execute) throw new Error('Tool execute is undefined')
    await tool.execute({ projectId: 'proj-1', assigneeId: 'other-user' }, { toolCallId: '1', messages: [] })

    expect(capturedAssigneeId).toBe('other-user')
  })

  test('should work without assigneeId filter', async () => {
    let capturedParams: { assigneeId?: string } | undefined
    const listTasks = mock((_projectId: string, params?: { assigneeId?: string }) => {
      capturedParams = params
      return Promise.resolve([
        {
          id: 'task-1',
          title: 'Test Task',
          status: 'todo',
          url: 'https://test.com/task/1',
        },
      ])
    })

    const provider = createMockProvider({ listTasks })
    const tool = makeListTasksTool(provider, testUserId)

    if (!tool.execute) throw new Error('Tool execute is undefined')
    await tool.execute({ projectId: 'proj-1' }, { toolCallId: '1', messages: [] })

    expect(capturedParams?.assigneeId).toBeUndefined()
  })

  test('should use login when provider prefers login identifier', async () => {
    setIdentityMapping({
      contextId: testUserId,
      providerName: 'mock',
      providerUserId: 'resolved-user-789',
      providerUserLogin: 'jsmith',
      displayName: 'John Smith',
      matchMethod: 'manual_nl',
      confidence: 100,
    })

    let capturedAssigneeId: string | undefined
    const listTasks = mock((_projectId: string, params?: { assigneeId?: string }) => {
      capturedAssigneeId = params?.assigneeId
      return Promise.resolve([
        {
          id: 'task-1',
          title: 'Test Task',
          status: 'todo',
          url: 'https://test.com/task/1',
        },
      ])
    })

    const provider = createMockProvider({ listTasks, preferredUserIdentifier: 'login' })
    const tool = makeListTasksTool(provider, testUserId)

    if (!tool.execute) throw new Error('Tool execute is undefined')
    await tool.execute({ projectId: 'proj-1', assigneeId: 'me' }, { toolCallId: '1', messages: [] })

    expect(listTasks).toHaveBeenCalledTimes(1)
    expect(capturedAssigneeId).toBe('jsmith')
  })

  describe('timezone config lookup (NI2 fix)', () => {
    test('should use storageContextId for timezone in group chats', async () => {
      const chatUserId = 'user-123'
      const storageContextId = 'group-456'
      setConfig(storageContextId, 'timezone', 'Europe/London')

      expect(getConfig(chatUserId, 'timezone')).toBeNull()

      const listTasks = mock(() => {
        return Promise.resolve([
          {
            id: 'task-1',
            title: 'Test Task',
            status: 'todo',
            dueDate: '2024-06-15T12:00:00Z',
            url: 'https://test.com/task/1',
          },
        ])
      })

      const provider = createMockProvider({ listTasks })
      const tool = makeListTasksTool(provider, chatUserId, storageContextId)

      if (!tool.execute) throw new Error('Tool execute is undefined')
      const result: unknown = await tool.execute({ projectId: 'proj-1' }, { toolCallId: '1', messages: [] })

      if (!Array.isArray(result)) throw new Error('Expected array')
      if (!hasDueDate(result[0])) throw new Error('Expected task with dueDate')
      expect(result[0].dueDate).toContain('13:00')
    })

    test('should fallback to UTC when no timezone configured', async () => {
      const chatUserId = 'user-123'
      const storageContextId = 'group-456'

      const listTasks = mock(() => {
        return Promise.resolve([
          {
            id: 'task-1',
            title: 'Test Task',
            status: 'todo',
            dueDate: '2024-06-15T12:00:00Z',
            url: 'https://test.com/task/1',
          },
        ])
      })

      const provider = createMockProvider({ listTasks })
      const tool = makeListTasksTool(provider, chatUserId, storageContextId)

      if (!tool.execute) throw new Error('Tool execute is undefined')
      const result: unknown = await tool.execute({ projectId: 'proj-1' }, { toolCallId: '1', messages: [] })

      if (!Array.isArray(result)) throw new Error('Expected array')
      if (!hasDueDate(result[0])) throw new Error('Expected task with dueDate')
      expect(result[0].dueDate).toContain('12:00')
    })
  })
})
