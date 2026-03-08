// Set required env vars before any imports
process.env['HULY_URL'] = 'http://localhost:8087'
process.env['HULY_WORKSPACE'] = 'test-workspace'

import { Database } from 'bun:sqlite'
import { describe, it, expect, beforeAll, afterAll, mock } from 'bun:test'

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
import { migration001Initial } from '../../src/db/migrations/001_initial.js'
import { migration002ConversationHistory } from '../../src/db/migrations/002_conversation_history.js'
import { migration003MultiuserSupport } from '../../src/db/migrations/003_multiuser_support.js'
import { migration004MigratedIssues } from '../../src/db/migrations/004_migrated_issues.js'

const MIGRATIONS = [
  migration001Initial,
  migration002ConversationHistory,
  migration003MultiuserSupport,
  migration004MigratedIssues,
] as const

describe('Migration Integration', () => {
  let db: Database
  let runLinearToHulyMigration: typeof import('../../src/migration/migrate.js').runLinearToHulyMigration
  let isMigrationComplete: typeof import('../../src/db/migration-status.js').isMigrationComplete
  let setMigrationStatus: typeof import('../../src/db/migration-status.js').setMigrationStatus

  beforeAll(async () => {
    db = new Database(':memory:')
    db.run('PRAGMA journal_mode=WAL')
    db.run('PRAGMA foreign_keys=ON')
    runMigrations(db, MIGRATIONS)

    // Mock getDb to return our test database
    await mock.module('../../src/db/index.js', () => ({
      getDb: (): Database => db,
      closeDb: (): void => {
        db.close()
      },
      DB_PATH: ':memory:',
      initDb: (): void => {},
    }))

    // Now import the modules that depend on getDb
    const migrateModule = await import('../../src/migration/migrate.js')
    const statusModule = await import('../../src/db/migration-status.js')

    runLinearToHulyMigration = migrateModule.runLinearToHulyMigration
    isMigrationComplete = statusModule.isMigrationComplete
    setMigrationStatus = statusModule.setMigrationStatus
  })

  afterAll(() => {
    db.close()
  })

  it('should handle migration when no Linear credentials exist', async () => {
    setMigrationStatus('linear_to_huly', 'pending')

    const result = await runLinearToHulyMigration()

    // Should complete successfully even with no data
    expect(result.success).toBe(true)
    expect(result.migratedCount).toBe(0)
    expect(isMigrationComplete('linear_to_huly')).toBe(true)
  })

  it('should skip migration when already completed', async () => {
    setMigrationStatus('linear_to_huly', 'completed')

    const result = await runLinearToHulyMigration()

    expect(result.success).toBe(true)
    expect(result.migratedCount).toBe(0)
  })
})
