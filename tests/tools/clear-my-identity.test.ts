import { beforeEach, describe, expect, test } from 'bun:test'

import { clearIdentityMapping, getIdentityMapping, setIdentityMapping } from '../../src/identity/mapping.js'
import type { TaskProvider } from '../../src/providers/types.js'
import { makeClearMyIdentityTool } from '../../src/tools/clear-my-identity.js'
import { getToolExecutor, mockLogger, setupTestDb } from '../utils/test-helpers.js'

const mockProvider: TaskProvider = {
  name: 'mock',
  capabilities: new Set(),
  configRequirements: [],
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

describe('clear_my_identity tool', () => {
  const testUserId = 'test-user-clear-123'

  beforeEach(async () => {
    mockLogger()
    await setupTestDb()

    // Setup initial mapping
    setIdentityMapping({
      contextId: testUserId,
      providerName: 'mock',
      providerUserId: 'user-123',
      providerUserLogin: 'jsmith',
      displayName: 'John Smith',
      matchMethod: 'auto',
      confidence: 100,
    })
  })

  test('returns tool with correct structure', () => {
    const tool = makeClearMyIdentityTool(mockProvider, testUserId)
    expect(tool.description).toContain('identity')
  })

  test('should clear identity mapping', async () => {
    const tool = makeClearMyIdentityTool(mockProvider, testUserId)
    const result: unknown = await getToolExecutor(tool)({}, { toolCallId: '1', messages: [] })

    expect(result).toHaveProperty('status', 'success')
    const mapping = getIdentityMapping(testUserId, 'mock')
    expect(mapping?.providerUserId).toBeNull()
    expect(mapping?.matchMethod).toBe('unmatched')
  })

  test('should return info when no mapping exists', async () => {
    // Clear any existing mapping first
    clearIdentityMapping(testUserId, 'mock')

    const tool = makeClearMyIdentityTool(mockProvider, testUserId)
    const result: unknown = await getToolExecutor(tool)({}, { toolCallId: '1', messages: [] })

    expect(result).toHaveProperty('status', 'info')
    expect(result).toHaveProperty('message', 'No identity mapping to clear.')
  })
})
