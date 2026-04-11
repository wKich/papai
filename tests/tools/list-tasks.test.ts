import { describe, expect, test, mock, beforeEach, afterAll } from 'bun:test'

import { setIdentityMapping, clearIdentityMapping } from '../../src/identity/mapping.js'
import { makeListTasksTool } from '../../src/tools/list-tasks.js'
import { mockLogger, setupTestDb } from '../utils/test-helpers.js'
import { createMockProvider } from './mock-provider.js'

describe('list_tasks identity resolution', () => {
  const testUserId = 'test-list-identity'

  beforeEach(async () => {
    mockLogger()
    await setupTestDb()
    // Clear any existing identity mapping
    clearIdentityMapping(testUserId, 'mock')
  })

  afterAll(() => {
    mock.restore()
  })

  test('should resolve "me" assigneeId to identity', async () => {
    // Setup identity mapping
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
    // Setup identity mapping
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
    // Set an unmatched mapping
    setIdentityMapping({
      contextId: 'unmatched-user',
      providerName: 'mock',
      providerUserId: '',
      providerUserLogin: '',
      displayName: '',
      matchMethod: 'unmatched',
      confidence: 0,
    })
    // Clear it to set providerUserId to null (the actual unmatched state)
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
    // Setup identity mapping
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
})
