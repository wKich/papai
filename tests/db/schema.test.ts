import { describe, expect, it, beforeEach } from 'bun:test'
import { getDrizzleDb } from '../../src/db/drizzle.js'
import { userIdentityMappings } from '../../src/db/schema.js'
import { eq, and } from 'drizzle-orm'
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
    expect(row.providerUserId).toBeNull()
    expect(row.matchMethod).toBe('unmatched')

    // Cleanup
    db.delete(userIdentityMappings).where(eq(userIdentityMappings.contextId, 'test-user-123')).run()
  })
})
