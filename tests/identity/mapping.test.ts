import { beforeEach, describe, expect, it } from 'bun:test'

import { clearIdentityMapping, getIdentityMapping, setIdentityMapping } from '../../src/identity/mapping.js'
import { mockLogger, setupTestDb } from '../utils/test-helpers.js'

describe('identity mapping CRUD', () => {
  const testContextId = 'test-context-123'
  const testProvider = 'youtrack'

  beforeEach(async () => {
    mockLogger()
    await setupTestDb()
  })

  it('should return null when no mapping exists', () => {
    const result = getIdentityMapping(testContextId, testProvider)
    expect(result).toBeNull()
  })

  it('should store and retrieve a mapping', () => {
    setIdentityMapping({
      contextId: testContextId,
      providerName: testProvider,
      providerUserId: 'yt-123',
      providerUserLogin: 'jsmith',
      displayName: 'John Smith',
      matchMethod: 'auto',
      confidence: 100,
    })

    const result = getIdentityMapping(testContextId, testProvider)
    expect(result).not.toBeNull()
    expect(result?.providerUserLogin).toBe('jsmith')
    expect(result?.matchMethod).toBe('auto')
  })

  it('should clear a mapping', () => {
    setIdentityMapping({
      contextId: testContextId,
      providerName: testProvider,
      providerUserId: 'yt-123',
      providerUserLogin: 'jsmith',
      displayName: 'John Smith',
      matchMethod: 'auto',
      confidence: 100,
    })

    clearIdentityMapping(testContextId, testProvider)

    const result = getIdentityMapping(testContextId, testProvider)
    expect(result).not.toBeNull()
    expect(result?.providerUserId).toBeNull()
    expect(result?.matchMethod).toBe('unmatched')
  })
})
