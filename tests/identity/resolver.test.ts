import { describe, expect, it, beforeEach } from 'bun:test'

import { getIdentityMapping, setIdentityMapping, clearIdentityMapping } from '../../src/identity/mapping.js'
import { resolveMeReference, attemptAutoLink } from '../../src/identity/resolver.js'
import type { TaskProvider } from '../../src/providers/types.js'
import { mockLogger, setupTestDb } from '../utils/test-helpers.js'

// Mock provider with identity resolver
const mockProvider: TaskProvider = {
  name: 'mock',
  capabilities: new Set(),
  configRequirements: [],
  identityResolver: {
    searchUsers: (query: string) => {
      if (query === 'jsmith') {
        return Promise.resolve([{ id: 'user-123', login: 'jsmith', name: 'John Smith' }])
      }
      if (query === 'JDOE') {
        return Promise.resolve([{ id: 'user-456', login: 'jdoe', name: 'Jane Doe' }])
      }
      return Promise.resolve([])
    },
  },
  buildTaskUrl: () => '',
  buildProjectUrl: () => '',
  classifyError: (e) => {
    throw e
  },
  getPromptAddendum: () => '',
  createTask() {
    return Promise.reject(new Error('not implemented'))
  },
  getTask() {
    return Promise.reject(new Error('not implemented'))
  },
  updateTask() {
    return Promise.reject(new Error('not implemented'))
  },
  listTasks() {
    return Promise.reject(new Error('not implemented'))
  },
  searchTasks() {
    return Promise.reject(new Error('not implemented'))
  },
} as TaskProvider

describe('resolveMeReference', () => {
  const testContextId = 'test-resolver-123'

  beforeEach(async () => {
    mockLogger()
    await setupTestDb()
    clearIdentityMapping(testContextId, 'mock')
  })

  it('should return not_found when no mapping exists', () => {
    const providerWithoutResolver = { ...mockProvider, identityResolver: undefined }
    const result = resolveMeReference(testContextId, providerWithoutResolver as TaskProvider)
    expect(result.type).toBe('not_found')
  })

  it('should return found when mapping exists', () => {
    setIdentityMapping({
      contextId: testContextId,
      providerName: 'mock',
      providerUserId: 'user-123',
      providerUserLogin: 'jsmith',
      displayName: 'John Smith',
      matchMethod: 'manual_nl',
      confidence: 100,
    })

    const result = resolveMeReference(testContextId, mockProvider)
    expect(result.type).toBe('found')
    if (result.type === 'found') {
      expect(result.identity.login).toBe('jsmith')
      expect(result.identity.userId).toBe('user-123')
      expect(result.identity.displayName).toBe('John Smith')
    }
  })

  it('should return unmatched when mapping is marked unmatched', () => {
    setIdentityMapping({
      contextId: testContextId,
      providerName: 'mock',
      providerUserId: 'unmatched-id',
      providerUserLogin: 'unmatched-login',
      displayName: 'Unmatched User',
      matchMethod: 'unmatched',
      confidence: 0,
    })

    clearIdentityMapping(testContextId, 'mock')

    const result = resolveMeReference(testContextId, mockProvider)
    expect(result.type).toBe('unmatched')
  })

  it('should handle mapping with empty displayName', () => {
    setIdentityMapping({
      contextId: testContextId,
      providerName: 'mock',
      providerUserId: 'user-123',
      providerUserLogin: 'jsmith',
      displayName: '',
      matchMethod: 'manual_nl',
      confidence: 100,
    })

    const result = resolveMeReference(testContextId, mockProvider)
    expect(result.type).toBe('found')
    if (result.type === 'found') {
      expect(result.identity.displayName).toBe('')
    }
  })
})

describe('attemptAutoLink', () => {
  const testContextId = 'test-autolink-123'

  beforeEach(async () => {
    mockLogger()
    await setupTestDb()
    clearIdentityMapping(testContextId, 'mock')
  })

  it('should auto-link when exact match found', async () => {
    const result = await attemptAutoLink(testContextId, 'jsmith', mockProvider)
    expect(result.type).toBe('found')
    if (result.type === 'found') {
      expect(result.identity.login).toBe('jsmith')
      expect(result.identity.userId).toBe('user-123')
      expect(result.identity.displayName).toBe('John Smith')
    }

    const mapping = getIdentityMapping(testContextId, 'mock')
    expect(mapping?.providerUserLogin).toBe('jsmith')
    expect(mapping?.matchMethod).toBe('auto')
    expect(mapping?.confidence).toBe(100)
  })

  it('should auto-link with case-insensitive match', async () => {
    const result = await attemptAutoLink(testContextId, 'JDOE', mockProvider)
    expect(result.type).toBe('found')
    if (result.type === 'found') {
      expect(result.identity.login).toBe('jdoe')
    }
  })

  it('should return unmatched when no exact match found', async () => {
    const result = await attemptAutoLink(testContextId, 'unknownuser', mockProvider)
    expect(result.type).toBe('unmatched')

    const mapping = getIdentityMapping(testContextId, 'mock')
    expect(mapping?.matchMethod).toBe('unmatched')
    expect(mapping?.confidence).toBe(0)
  })

  it('should return not_found when provider has no identity resolver', async () => {
    const providerWithoutResolver = { ...mockProvider, identityResolver: undefined }
    const result = await attemptAutoLink(testContextId, 'jsmith', providerWithoutResolver as TaskProvider)
    expect(result.type).toBe('not_found')
  })

  it('should handle search errors gracefully', async () => {
    const providerWithFailingResolver: TaskProvider = {
      ...mockProvider,
      identityResolver: {
        searchUsers: () => Promise.reject(new Error('Network error')),
      },
    } as TaskProvider

    const result = await attemptAutoLink(testContextId, 'jsmith', providerWithFailingResolver)
    expect(result.type).toBe('not_found')
    if (result.type === 'not_found') {
      expect(result.message).toContain('Unable to search')
    }
  })
})
