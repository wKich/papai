import { describe, expect, test, mock, beforeEach, afterAll } from 'bun:test'

import { setIdentityMapping, clearIdentityMapping } from '../../src/identity/mapping.js'
import { resolveMeReference } from '../../src/identity/resolver.js'
import { makeCreateTaskTool } from '../../src/tools/create-task.js'
import { mockLogger, setupTestDb } from '../utils/test-helpers.js'
import { createMockProvider } from './mock-provider.js'

describe('create_task identity resolution', () => {
  beforeEach(async () => {
    mockLogger()
    await setupTestDb()
    // Clear any existing identity mapping
    clearIdentityMapping('test-user-456', 'mock')
  })

  afterAll(() => {
    mock.restore()
  })

  test('should resolve "me" assignee to identity', () => {
    // Setup identity mapping
    setIdentityMapping({
      contextId: 'test-user-456',
      providerName: 'mock',
      providerUserId: 'resolved-user-789',
      providerUserLogin: 'jsmith',
      displayName: 'John Smith',
      matchMethod: 'manual_nl',
      confidence: 100,
    })

    const result = resolveMeReference('test-user-456', createMockProvider())
    expect(result.type).toBe('found')
    if (result.type === 'found') {
      expect(result.identity.userId).toBe('resolved-user-789')
    }
  })

  test('should return not_found when no identity mapping exists', () => {
    const result = resolveMeReference('unknown-user', createMockProvider())
    expect(result.type).toBe('not_found')
    if (result.type === 'not_found') {
      expect(result.message).toContain("don't know who you are")
    }
  })

  test('should return unmatched when identity was previously unmatched', () => {
    // Set an unmatched mapping using null for providerUserId
    setIdentityMapping({
      contextId: 'unmatched-user',
      providerName: 'mock',
      providerUserId: '',
      providerUserLogin: '',
      displayName: '',
      matchMethod: 'unmatched',
      confidence: 0,
    })

    // Clear it first to set providerUserId to null (the actual unmatched state)
    clearIdentityMapping('unmatched-user', 'mock')

    const result = resolveMeReference('unmatched-user', createMockProvider())
    expect(result.type).toBe('unmatched')
    if (result.type === 'unmatched') {
      expect(result.message).toContain("couldn't automatically match")
    }
  })

  test('create_task tool should resolve "me" assignee to provider user ID', async () => {
    // Setup identity mapping
    setIdentityMapping({
      contextId: 'test-user-456',
      providerName: 'mock',
      providerUserId: 'resolved-user-789',
      providerUserLogin: 'jsmith',
      displayName: 'John Smith',
      matchMethod: 'manual_nl',
      confidence: 100,
    })

    let capturedAssignee: string | undefined
    const createTask = mock((params: { title: string; assignee?: string }) => {
      capturedAssignee = params.assignee
      return Promise.resolve({
        id: 'task-1',
        title: params.title,
        status: 'todo',
        url: 'https://test.com/task/1',
      })
    })

    const provider = createMockProvider({ createTask })
    const tool = makeCreateTaskTool(provider, 'test-user-456')

    if (!tool.execute) throw new Error('Tool execute is undefined')
    await tool.execute({ title: 'Test Task', projectId: 'proj-1', assignee: 'me' }, { toolCallId: '1', messages: [] })

    expect(createTask).toHaveBeenCalledTimes(1)
    expect(capturedAssignee).toBe('resolved-user-789')
  })

  test('create_task tool should resolve "ME" (uppercase) assignee to identity', async () => {
    // Setup identity mapping
    setIdentityMapping({
      contextId: 'test-user-456',
      providerName: 'mock',
      providerUserId: 'resolved-user-789',
      providerUserLogin: 'jsmith',
      displayName: 'John Smith',
      matchMethod: 'manual_nl',
      confidence: 100,
    })

    let capturedAssignee: string | undefined
    const createTask = mock((params: { title: string; assignee?: string }) => {
      capturedAssignee = params.assignee
      return Promise.resolve({
        id: 'task-1',
        title: params.title,
        status: 'todo',
        url: 'https://test.com/task/1',
      })
    })

    const provider = createMockProvider({ createTask })
    const tool = makeCreateTaskTool(provider, 'test-user-456')

    if (!tool.execute) throw new Error('Tool execute is undefined')
    await tool.execute({ title: 'Test Task', projectId: 'proj-1', assignee: 'ME' }, { toolCallId: '1', messages: [] })

    expect(capturedAssignee).toBe('resolved-user-789')
  })

  test('create_task tool should return identity_required when no mapping exists', async () => {
    const provider = createMockProvider()
    const tool = makeCreateTaskTool(provider, 'no-mapping-user')

    if (!tool.execute) throw new Error('Tool execute is undefined')
    const result: unknown = await tool.execute(
      { title: 'Test Task', projectId: 'proj-1', assignee: 'me' },
      { toolCallId: '1', messages: [] },
    )

    expect(result).toHaveProperty('status', 'identity_required')
    expect(result).toHaveProperty('message')
    if (typeof result === 'object' && result !== null && 'message' in result) {
      expect(result.message).toContain("don't know who you are")
    }
  })

  test('create_task tool should pass through non-me assignee unchanged', async () => {
    let capturedAssignee: string | undefined
    const createTask = mock((params: { title: string; assignee?: string }) => {
      capturedAssignee = params.assignee
      return Promise.resolve({
        id: 'task-1',
        title: params.title,
        status: 'todo',
        url: 'https://test.com/task/1',
      })
    })

    const provider = createMockProvider({ createTask })
    const tool = makeCreateTaskTool(provider, 'test-user-456')

    if (!tool.execute) throw new Error('Tool execute is undefined')
    await tool.execute(
      { title: 'Test Task', projectId: 'proj-1', assignee: 'other-user' },
      { toolCallId: '1', messages: [] },
    )

    expect(capturedAssignee).toBe('other-user')
  })

  test('create_task tool should work without assignee', async () => {
    let capturedAssignee: string | undefined = 'initial'
    const createTask = mock((params: { title: string; assignee?: string }) => {
      capturedAssignee = params.assignee
      return Promise.resolve({
        id: 'task-1',
        title: params.title,
        status: 'todo',
        url: 'https://test.com/task/1',
      })
    })

    const provider = createMockProvider({ createTask })
    const tool = makeCreateTaskTool(provider, 'test-user-456')

    if (!tool.execute) throw new Error('Tool execute is undefined')
    await tool.execute({ title: 'Test Task', projectId: 'proj-1' }, { toolCallId: '1', messages: [] })

    expect(capturedAssignee).toBeUndefined()
  })
})
