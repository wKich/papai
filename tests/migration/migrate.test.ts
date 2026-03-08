// Set required env vars before any imports
process.env['HULY_URL'] = 'http://localhost:8087'
process.env['HULY_WORKSPACE'] = 'test-workspace'

import { Database } from 'bun:sqlite'
import { describe, it, expect, beforeEach, afterEach, mock } from 'bun:test'

// Mock the logger to avoid console output during tests
void mock.module('../../src/logger.js', () => ({
  logger: {
    debug: (): void => {},
    info: (): void => {},
    warn: (): void => {},
    error: (): void => {},
    child: (): object => ({
      debug: (): void => {},
      info: (): void => {},
      warn: (): void => {},
      error: (): void => {},
    }),
  },
}))

import { runMigrations } from '../../src/db/migrate.js'
import { isIssueMigrated, recordMigratedIssue, getMigratedIssueCount } from '../../src/db/migrated-issues.js'
import { setMigrationStatus, getMigrationStatus, isMigrationComplete } from '../../src/db/migration-status.js'
import { migration001Initial } from '../../src/db/migrations/001_initial.js'
import { migration002ConversationHistory } from '../../src/db/migrations/002_conversation_history.js'
import { migration003MultiuserSupport } from '../../src/db/migrations/003_multiuser_support.js'
import { migration004MigratedIssues } from '../../src/db/migrations/004_migrated_issues.js'
import { runLinearToHulyMigration } from '../../src/migration/migrate.js'

const MIGRATIONS = [
  migration001Initial,
  migration002ConversationHistory,
  migration003MultiuserSupport,
  migration004MigratedIssues,
] as const

describe('Migration Engine', () => {
  let db: Database

  beforeEach(() => {
    db = new Database(':memory:')
    runMigrations(db, MIGRATIONS)
    setMigrationStatus('linear_to_huly', 'pending', undefined, db)
  })

  afterEach(() => {
    db.close()
  })

  describe('Basic functionality', () => {
    it('should be defined', () => {
      expect(typeof runLinearToHulyMigration).toBe('function')
    })
  })

  describe('Skip when already completed', () => {
    it('should return true for completed migration', () => {
      setMigrationStatus('linear_to_huly', 'completed', undefined, db)

      expect(isMigrationComplete('linear_to_huly', db)).toBe(true)
      expect(getMigrationStatus('linear_to_huly', db)).toBe('completed')
    })
  })

  describe('Prevent concurrent runs', () => {
    it('should detect in_progress status', () => {
      setMigrationStatus('linear_to_huly', 'in_progress', undefined, db)

      expect(getMigrationStatus('linear_to_huly', db)).toBe('in_progress')
      expect(isMigrationComplete('linear_to_huly', db)).toBe(false)
    })
  })

  describe('Idempotency', () => {
    it('should track migrated issues', () => {
      const userId = 12345

      expect(isIssueMigrated(userId, 'linear-issue-1', db)).toBe(false)

      recordMigratedIssue(userId, 'linear-issue-1', 'huly-issue-1', db)

      expect(isIssueMigrated(userId, 'linear-issue-1', db)).toBe(true)
      expect(isIssueMigrated(userId, 'linear-issue-2', db)).toBe(false)
    })

    it('should track migrated issues per user', () => {
      const userId1 = 12345
      const userId2 = 67890

      recordMigratedIssue(userId1, 'linear-issue-1', 'huly-issue-1', db)

      expect(isIssueMigrated(userId1, 'linear-issue-1', db)).toBe(true)
      expect(isIssueMigrated(userId2, 'linear-issue-1', db)).toBe(false)
    })

    it('should count migrated issues per user', () => {
      const userId = 12345

      expect(getMigratedIssueCount(userId, db)).toBe(0)

      recordMigratedIssue(userId, 'linear-issue-1', 'huly-issue-1', db)
      expect(getMigratedIssueCount(userId, db)).toBe(1)

      recordMigratedIssue(userId, 'linear-issue-2', 'huly-issue-2', db)
      expect(getMigratedIssueCount(userId, db)).toBe(2)
    })

    it('should handle duplicate migration records gracefully', () => {
      const userId = 12345

      recordMigratedIssue(userId, 'linear-issue-1', 'huly-issue-1', db)
      recordMigratedIssue(userId, 'linear-issue-1', 'huly-issue-1', db)

      expect(getMigratedIssueCount(userId, db)).toBe(1)
    })
  })

  describe('Migration status management', () => {
    it('should update status correctly', () => {
      expect(getMigrationStatus('linear_to_huly', db)).toBe('pending')

      setMigrationStatus('linear_to_huly', 'in_progress', undefined, db)
      expect(getMigrationStatus('linear_to_huly', db)).toBe('in_progress')

      setMigrationStatus('linear_to_huly', 'completed', undefined, db)
      expect(getMigrationStatus('linear_to_huly', db)).toBe('completed')
    })

    it('should record error message on failure', () => {
      setMigrationStatus('linear_to_huly', 'failed', 'Test error', db)

      const row = db
        .query<{ error_message: string | null }, []>(
          'SELECT error_message FROM migration_status WHERE migration_name = ?',
        )
        .get('linear_to_huly')

      expect(row?.error_message).toBe('Test error')
    })
  })
})
