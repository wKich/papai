import { beforeEach, describe, expect, mock, test } from 'bun:test'

import { getIdentityMapping, clearIdentityMapping } from '../../src/identity/mapping.js'
import type { TaskProvider } from '../../src/providers/types.js'
import { makeSetMyIdentityTool } from '../../src/tools/set-my-identity.js'
import { mockLogger, setupTestDb, getToolExecutor } from '../utils/test-helpers.js'

const mockProvider: TaskProvider = {
  name: 'mock',
  capabilities: new Set(),
  configRequirements: [],
  identityResolver: {
    searchUsers: mock((query: string) => {
      if (query === 'jsmith') {
        return Promise.resolve([{ id: 'user-123', login: 'jsmith', name: 'John Smith' }])
      }
      return Promise.resolve([])
    }),
  },
  buildTaskUrl: () => '',
  buildProjectUrl: () => '',
  classifyError: (e) => {
    throw e
  },
  getPromptAddendum: () => '',
  createTask(): Promise<never> {
    throw new Error('not implemented')
  },
  getTask(): Promise<never> {
    throw new Error('not implemented')
  },
  updateTask(): Promise<never> {
    throw new Error('not implemented')
  },
  listTasks(): Promise<never> {
    throw new Error('not implemented')
  },
  searchTasks(): Promise<never> {
    throw new Error('not implemented')
  },
} as TaskProvider

describe('set_my_identity tool', () => {
  const testUserId = 'test-user-tool-123'

  beforeEach(async () => {
    mockLogger()
    await setupTestDb()
    clearIdentityMapping(testUserId, 'mock')
  })

  test('returns tool with correct structure', () => {
    const tool = makeSetMyIdentityTool(mockProvider, testUserId)
    expect(tool.description).toContain('identity')
  })

  test('should create identity mapping when user found', async () => {
    const tool = makeSetMyIdentityTool(mockProvider, testUserId)
    const result: unknown = await getToolExecutor(tool)({ claim: "I'm jsmith" }, { toolCallId: '1', messages: [] })

    expect(result).toHaveProperty('status', 'success')
    const mapping = getIdentityMapping(testUserId, 'mock')
    expect(mapping?.providerUserLogin).toBe('jsmith')
  })

  test('should return error when user not found', async () => {
    const tool = makeSetMyIdentityTool(mockProvider, testUserId)
    const result: unknown = await getToolExecutor(tool)({ claim: "I'm nonexistent" }, { toolCallId: '1', messages: [] })

    expect(result).toHaveProperty('status', 'error')
  })

  test('should return error when provider has no identity resolver', async () => {
    const providerWithoutResolver = {
      ...mockProvider,
      identityResolver: undefined,
    } as TaskProvider

    const tool = makeSetMyIdentityTool(providerWithoutResolver, testUserId)
    const result: unknown = await getToolExecutor(tool)({ claim: "I'm jsmith" }, { toolCallId: '1', messages: [] })

    expect(result).toHaveProperty('status', 'error')
  })

  test('should return error when claim cannot be parsed', async () => {
    const tool = makeSetMyIdentityTool(mockProvider, testUserId)
    const result: unknown = await getToolExecutor(tool)(
      { claim: 'just some random text' },
      { toolCallId: '1', messages: [] },
    )

    expect(result).toHaveProperty('status', 'error')
  })
})
