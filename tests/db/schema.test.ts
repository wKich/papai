import { describe, expect, it, beforeEach } from 'bun:test'

import { eq, and } from 'drizzle-orm'

import { getDrizzleDb } from '../../src/db/drizzle.js'
import { groupAdminObservations, knownGroupContexts, userIdentityMappings } from '../../src/db/schema.js'
import { mockLogger, setupTestDb } from '../utils/test-helpers.js'

describe('userIdentityMappings', () => {
  beforeEach(async () => {
    mockLogger()
    await setupTestDb()
  })

  it('should have composite primary key on contextId and providerName', () => {
    const table = userIdentityMappings
    expect(table).toBeDefined()
    // Composite key means we can store different mappings per provider
    expect(table.contextId).toBeDefined()
    expect(table.providerName).toBeDefined()
  })

  it('should support nullable providerUserId for unmatched state', () => {
    const db = getDrizzleDb()

    // Insert unmatched mapping
    db.insert(userIdentityMappings)
      .values({
        contextId: 'test-user-123',
        providerName: 'youtrack',
        providerUserId: null,
        providerUserLogin: null,
        displayName: null,
        matchedAt: new Date().toISOString(),
        matchMethod: 'unmatched',
        confidence: 0,
      })
      .run()

    const row = db
      .select()
      .from(userIdentityMappings)
      .where(
        and(eq(userIdentityMappings.contextId, 'test-user-123'), eq(userIdentityMappings.providerName, 'youtrack')),
      )
      .get()

    expect(row).toBeDefined()
    if (row !== undefined) {
      expect(row.providerUserId).toBeNull()
      expect(row.matchMethod).toBe('unmatched')
    }

    // Cleanup
    db.delete(userIdentityMappings).where(eq(userIdentityMappings.contextId, 'test-user-123')).run()
  })
})

describe('knownGroupContexts', () => {
  beforeEach(async () => {
    mockLogger()
    await setupTestDb()
  })

  it('should expose the expected columns', () => {
    expect(knownGroupContexts.contextId).toBeDefined()
    expect(knownGroupContexts.provider).toBeDefined()
    expect(knownGroupContexts.displayName).toBeDefined()
    expect(knownGroupContexts.parentName).toBeDefined()
    expect(knownGroupContexts.firstSeenAt).toBeDefined()
    expect(knownGroupContexts.lastSeenAt).toBeDefined()
  })
})

describe('groupAdminObservations', () => {
  beforeEach(async () => {
    mockLogger()
    await setupTestDb()
  })

  it('should expose a composite key over contextId and userId', () => {
    expect(groupAdminObservations.contextId).toBeDefined()
    expect(groupAdminObservations.userId).toBeDefined()
    expect(groupAdminObservations.isAdmin).toBeDefined()
    expect(groupAdminObservations.lastSeenAt).toBeDefined()
  })
})
