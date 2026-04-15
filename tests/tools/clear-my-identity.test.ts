import { beforeEach, describe, expect, test } from 'bun:test'

import { clearIdentityMapping, getIdentityMapping, setIdentityMapping } from '../../src/identity/mapping.js'
import type { TaskProvider } from '../../src/providers/types.js'
import { makeClearMyIdentityTool } from '../../src/tools/clear-my-identity.js'
import { localDatetimeToUtc, utcToLocal } from '../../src/utils/datetime.js'
import { getToolExecutor, mockLogger, setupTestDb } from '../utils/test-helpers.js'

const mockProvider: TaskProvider = {
  name: 'mock',
  capabilities: new Set(),
  configRequirements: [],
  preferredUserIdentifier: 'id',
  buildTaskUrl: () => '',
  buildProjectUrl: () => '',
  classifyError: (e) => {
    throw e
  },
  getPromptAddendum: () => '',
  normalizeDueDateInput: (dueDate, timezone) =>
    dueDate === undefined ? undefined : localDatetimeToUtc(dueDate.date, dueDate.time, timezone),
  formatDueDateOutput: (dueDate, timezone) =>
    dueDate === undefined || dueDate === null ? dueDate : utcToLocal(dueDate, timezone),
  normalizeListTaskParams: (params) => ({ ...params }),
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
}

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

  test('should isolate clear operations by chatUserId', async () => {
    // Setup another user's identity
    const otherUserId = 'user-other'
    setIdentityMapping({
      contextId: otherUserId,
      providerName: 'mock',
      providerUserId: 'user-999',
      providerUserLogin: 'otheruser',
      displayName: 'Other User',
      matchMethod: 'auto',
      confidence: 100,
    })

    // Clear first user's identity
    const tool = makeClearMyIdentityTool(mockProvider, testUserId)
    await getToolExecutor(tool)({}, { toolCallId: '1', messages: [] })

    // First user's identity should be cleared
    const clearedMapping = getIdentityMapping(testUserId, 'mock')
    expect(clearedMapping?.providerUserId).toBeNull()

    // Other user's identity should remain intact
    const otherMapping = getIdentityMapping(otherUserId, 'mock')
    expect(otherMapping?.providerUserId).toBe('user-999')
  })

  test('should use injected deps', async () => {
    const { getDrizzleDb } = await import('../../src/db/drizzle.js')
    let getDbCalled = false
    let clearCalled = false

    const mockGetDrizzleDb = (): ReturnType<typeof getDrizzleDb> => {
      getDbCalled = true
      return getDrizzleDb()
    }

    const mockClearIdentityMapping = (contextId: string, providerName: string): void => {
      clearCalled = true
      clearIdentityMapping(contextId, providerName)
    }

    const deps = {
      getIdentityMapping: (ctxId: string, provName: string): ReturnType<typeof getIdentityMapping> => {
        getDbCalled = true
        return getIdentityMapping(ctxId, provName)
      },
      clearIdentityMapping: mockClearIdentityMapping,
      getDrizzleDb: mockGetDrizzleDb,
    }

    const tool = makeClearMyIdentityTool(mockProvider, testUserId, deps)
    const result: unknown = await getToolExecutor(tool)({}, { toolCallId: '1', messages: [] })

    expect(result).toHaveProperty('status', 'success')
    expect(getDbCalled).toBe(true)
    expect(clearCalled).toBe(true)
  })
})
