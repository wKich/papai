import { describe, expect, test, mock, beforeEach, afterAll } from 'bun:test'

import { setIdentityMapping, clearIdentityMapping } from '../../src/identity/mapping.js'
import { makeSearchTasksTool } from '../../src/tools/search-tasks.js'
import { mockLogger, setupTestDb } from '../utils/test-helpers.js'
import { createMockProvider } from './mock-provider.js'

describe('search_tasks identity resolution', () => {
  beforeEach(async () => {
    mockLogger()
    await setupTestDb()
    clearIdentityMapping('test-search-identity', 'mock')
  })

  afterAll(() => {
    mock.restore()
  })

  test('should inject identity into "my tasks" query', async () => {
    setIdentityMapping({
      contextId: 'test-search-identity',
      providerName: 'mock',
      providerUserId: 'resolved-user-789',
      providerUserLogin: 'jsmith',
      displayName: 'John Smith',
      matchMethod: 'manual_nl',
      confidence: 100,
    })

    let capturedQuery: string | undefined
    const searchTasks = mock((params: { query: string; projectId?: string; limit?: number }) => {
      capturedQuery = params.query
      return Promise.resolve([{ id: 'task-1', title: 'Test Task', status: 'todo', url: 'https://test.com/task/1' }])
    })

    const provider = createMockProvider({ searchTasks })
    const tool = makeSearchTasksTool(provider, 'test-search-identity')

    if (!tool.execute) throw new Error('Tool execute is undefined')
    await tool.execute({ query: 'my tasks' }, { toolCallId: '1', messages: [] })

    expect(searchTasks).toHaveBeenCalledTimes(1)
    expect(capturedQuery).toBe('jsmith tasks')
  })

  test('should inject identity into "show me tasks" query', async () => {
    setIdentityMapping({
      contextId: 'test-search-identity',
      providerName: 'mock',
      providerUserId: 'resolved-user-789',
      providerUserLogin: 'jsmith',
      displayName: 'John Smith',
      matchMethod: 'manual_nl',
      confidence: 100,
    })

    let capturedQuery: string | undefined
    const searchTasks = mock((params: { query: string; projectId?: string; limit?: number }) => {
      capturedQuery = params.query
      return Promise.resolve([{ id: 'task-1', title: 'Test Task', status: 'todo', url: 'https://test.com/task/1' }])
    })

    const provider = createMockProvider({ searchTasks })
    const tool = makeSearchTasksTool(provider, 'test-search-identity')

    if (!tool.execute) throw new Error('Tool execute is undefined')
    await tool.execute({ query: 'show me tasks' }, { toolCallId: '1', messages: [] })

    expect(searchTasks).toHaveBeenCalledTimes(1)
    expect(capturedQuery).toBe('show jsmith tasks')
  })

  test('should inject identity into "MY TASKS" (uppercase) query', async () => {
    setIdentityMapping({
      contextId: 'test-search-identity',
      providerName: 'mock',
      providerUserId: 'resolved-user-789',
      providerUserLogin: 'jsmith',
      displayName: 'John Smith',
      matchMethod: 'manual_nl',
      confidence: 100,
    })

    let capturedQuery: string | undefined
    const searchTasks = mock((params: { query: string; projectId?: string; limit?: number }) => {
      capturedQuery = params.query
      return Promise.resolve([{ id: 'task-1', title: 'Test Task', status: 'todo', url: 'https://test.com/task/1' }])
    })

    const provider = createMockProvider({ searchTasks })
    const tool = makeSearchTasksTool(provider, 'test-search-identity')

    if (!tool.execute) throw new Error('Tool execute is undefined')
    await tool.execute({ query: 'MY TASKS' }, { toolCallId: '1', messages: [] })

    expect(searchTasks).toHaveBeenCalledTimes(1)
    expect(capturedQuery).toBe('jsmith TASKS')
  })

  test('should pass through query unchanged when no "my" or "me" in query', async () => {
    let capturedQuery: string | undefined
    const searchTasks = mock((params: { query: string; projectId?: string; limit?: number }) => {
      capturedQuery = params.query
      return Promise.resolve([{ id: 'task-1', title: 'Test Task', status: 'todo', url: 'https://test.com/task/1' }])
    })

    const provider = createMockProvider({ searchTasks })
    const tool = makeSearchTasksTool(provider, 'test-search-identity')

    if (!tool.execute) throw new Error('Tool execute is undefined')
    await tool.execute({ query: 'bug fix' }, { toolCallId: '1', messages: [] })

    expect(searchTasks).toHaveBeenCalledTimes(1)
    expect(capturedQuery).toBe('bug fix')
  })

  test('should pass through query unchanged when userId is undefined', async () => {
    let capturedQuery: string | undefined
    const searchTasks = mock((params: { query: string; projectId?: string; limit?: number }) => {
      capturedQuery = params.query
      return Promise.resolve([{ id: 'task-1', title: 'Test Task', status: 'todo', url: 'https://test.com/task/1' }])
    })

    const provider = createMockProvider({ searchTasks })
    const tool = makeSearchTasksTool(provider, undefined)

    if (!tool.execute) throw new Error('Tool execute is undefined')
    await tool.execute({ query: 'my tasks' }, { toolCallId: '1', messages: [] })

    expect(searchTasks).toHaveBeenCalledTimes(1)
    expect(capturedQuery).toBe('my tasks')
  })

  test('should pass through query unchanged when no identity mapping exists', async () => {
    let capturedQuery: string | undefined
    const searchTasks = mock((params: { query: string; projectId?: string; limit?: number }) => {
      capturedQuery = params.query
      return Promise.resolve([{ id: 'task-1', title: 'Test Task', status: 'todo', url: 'https://test.com/task/1' }])
    })

    const provider = createMockProvider({ searchTasks })
    const tool = makeSearchTasksTool(provider, 'no-mapping-user')

    if (!tool.execute) throw new Error('Tool execute is undefined')
    await tool.execute({ query: 'my tasks' }, { toolCallId: '1', messages: [] })

    expect(searchTasks).toHaveBeenCalledTimes(1)
    expect(capturedQuery).toBe('my tasks')
  })

  test('should preserve original query case when replacing', async () => {
    setIdentityMapping({
      contextId: 'test-search-identity',
      providerName: 'mock',
      providerUserId: 'resolved-user-789',
      providerUserLogin: 'jsmith',
      displayName: 'John Smith',
      matchMethod: 'manual_nl',
      confidence: 100,
    })

    let capturedQuery: string | undefined
    const searchTasks = mock((params: { query: string; projectId?: string; limit?: number }) => {
      capturedQuery = params.query
      return Promise.resolve([{ id: 'task-1', title: 'Test Task', status: 'todo', url: 'https://test.com/task/1' }])
    })

    const provider = createMockProvider({ searchTasks })
    const tool = makeSearchTasksTool(provider, 'test-search-identity')

    if (!tool.execute) throw new Error('Tool execute is undefined')
    await tool.execute({ query: 'Find My Open Tasks' }, { toolCallId: '1', messages: [] })

    expect(searchTasks).toHaveBeenCalledTimes(1)
    expect(capturedQuery).toBe('Find jsmith Open Tasks')
  })

  test('should replace multiple occurrences of "my"', async () => {
    setIdentityMapping({
      contextId: 'test-search-identity',
      providerName: 'mock',
      providerUserId: 'resolved-user-789',
      providerUserLogin: 'jsmith',
      displayName: 'John Smith',
      matchMethod: 'manual_nl',
      confidence: 100,
    })

    let capturedQuery: string | undefined
    const searchTasks = mock((params: { query: string; projectId?: string; limit?: number }) => {
      capturedQuery = params.query
      return Promise.resolve([{ id: 'task-1', title: 'Test Task', status: 'todo', url: 'https://test.com/task/1' }])
    })

    const provider = createMockProvider({ searchTasks })
    const tool = makeSearchTasksTool(provider, 'test-search-identity')

    if (!tool.execute) throw new Error('Tool execute is undefined')
    await tool.execute({ query: 'my tasks and my bugs' }, { toolCallId: '1', messages: [] })

    expect(searchTasks).toHaveBeenCalledTimes(1)
    expect(capturedQuery).toBe('jsmith tasks and jsmith bugs')
  })
})
