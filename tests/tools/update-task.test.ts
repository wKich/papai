import { describe, expect, test, mock, beforeEach, afterAll } from 'bun:test'

import { setIdentityMapping, clearIdentityMapping } from '../../src/identity/mapping.js'
import { makeUpdateTaskTool } from '../../src/tools/update-task.js'
import { mockLogger, setupTestDb } from '../utils/test-helpers.js'
import { createMockProvider } from './mock-provider.js'

describe('update_task identity resolution', () => {
  beforeEach(async () => {
    mockLogger()
    await setupTestDb()
    // Clear any existing identity mapping
    clearIdentityMapping('test-update-identity', 'mock')
  })

  afterAll(() => {
    mock.restore()
  })

  test('should resolve "me" assignee in update', async () => {
    // Setup identity mapping
    setIdentityMapping({
      contextId: 'test-update-identity',
      providerName: 'mock',
      providerUserId: 'resolved-user-789',
      providerUserLogin: 'jsmith',
      displayName: 'John Smith',
      matchMethod: 'manual_nl',
      confidence: 100,
    })

    let capturedAssignee: string | undefined
    const updateTask = mock((taskId: string, params: { assignee?: string }) => {
      capturedAssignee = params.assignee
      return Promise.resolve({
        id: taskId,
        title: 'Test Task',
        status: 'todo',
        url: 'https://test.com/task/1',
      })
    })

    const provider = createMockProvider({ updateTask })
    const tool = makeUpdateTaskTool(provider, undefined, 'test-update-identity')

    if (!tool.execute) throw new Error('Tool execute is undefined')
    await tool.execute({ taskId: 'task-1', assignee: 'me' }, { toolCallId: '1', messages: [] })

    expect(updateTask).toHaveBeenCalledTimes(1)
    expect(capturedAssignee).toBe('resolved-user-789')
  })

  test('should resolve "ME" (uppercase) assignee to identity', async () => {
    // Setup identity mapping
    setIdentityMapping({
      contextId: 'test-update-identity',
      providerName: 'mock',
      providerUserId: 'resolved-user-789',
      providerUserLogin: 'jsmith',
      displayName: 'John Smith',
      matchMethod: 'manual_nl',
      confidence: 100,
    })

    let capturedAssignee: string | undefined
    const updateTask = mock((taskId: string, params: { assignee?: string }) => {
      capturedAssignee = params.assignee
      return Promise.resolve({
        id: taskId,
        title: 'Test Task',
        status: 'todo',
        url: 'https://test.com/task/1',
      })
    })

    const provider = createMockProvider({ updateTask })
    const tool = makeUpdateTaskTool(provider, undefined, 'test-update-identity')

    if (!tool.execute) throw new Error('Tool execute is undefined')
    await tool.execute({ taskId: 'task-1', assignee: 'ME' }, { toolCallId: '1', messages: [] })

    expect(capturedAssignee).toBe('resolved-user-789')
  })

  test('should return identity_required when no mapping exists', async () => {
    const provider = createMockProvider()
    const tool = makeUpdateTaskTool(provider, undefined, 'no-mapping-user')

    if (!tool.execute) throw new Error('Tool execute is undefined')
    const result: unknown = await tool.execute({ taskId: 'task-1', assignee: 'me' }, { toolCallId: '1', messages: [] })

    expect(result).toHaveProperty('status', 'identity_required')
    expect(result).toHaveProperty('message')
    if (typeof result === 'object' && result !== null && 'message' in result) {
      expect(result.message).toContain("don't know who you are")
    }
  })

  test('should pass through non-me assignee unchanged', async () => {
    let capturedAssignee: string | undefined
    const updateTask = mock((taskId: string, params: { assignee?: string }) => {
      capturedAssignee = params.assignee
      return Promise.resolve({
        id: taskId,
        title: 'Test Task',
        status: 'todo',
        url: 'https://test.com/task/1',
      })
    })

    const provider = createMockProvider({ updateTask })
    const tool = makeUpdateTaskTool(provider, undefined, 'test-update-identity')

    if (!tool.execute) throw new Error('Tool execute is undefined')
    await tool.execute({ taskId: 'task-1', assignee: 'other-user' }, { toolCallId: '1', messages: [] })

    expect(capturedAssignee).toBe('other-user')
  })

  test('should work without assignee parameter', async () => {
    let capturedAssignee: string | undefined = 'initial'
    const updateTask = mock((taskId: string, params: { assignee?: string }) => {
      capturedAssignee = params.assignee
      return Promise.resolve({
        id: taskId,
        title: 'Test Task',
        status: 'todo',
        url: 'https://test.com/task/1',
      })
    })

    const provider = createMockProvider({ updateTask })
    const tool = makeUpdateTaskTool(provider, undefined, 'test-update-identity')

    if (!tool.execute) throw new Error('Tool execute is undefined')
    await tool.execute({ taskId: 'task-1', status: 'done' }, { toolCallId: '1', messages: [] })

    expect(capturedAssignee).toBeUndefined()
  })

  test('should pass "me" through unchanged when userId is undefined', async () => {
    let capturedAssignee: string | undefined
    const updateTask = mock((taskId: string, params: { assignee?: string }) => {
      capturedAssignee = params.assignee
      return Promise.resolve({
        id: taskId,
        title: 'Test Task',
        status: 'todo',
        url: 'https://test.com/task/1',
      })
    })

    const provider = createMockProvider({ updateTask })
    // Pass undefined for userId (3rd parameter)
    const tool = makeUpdateTaskTool(provider, undefined, undefined)

    if (!tool.execute) throw new Error('Tool execute is undefined')
    await tool.execute({ taskId: 'task-1', assignee: 'me' }, { toolCallId: '1', messages: [] })

    expect(capturedAssignee).toBe('me')
  })
})
