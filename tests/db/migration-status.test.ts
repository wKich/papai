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
import { getMigrationStatus, setMigrationStatus, isMigrationComplete } from '../../src/db/migration-status.js'
import { migration001Initial } from '../../src/db/migrations/001_initial.js'

describe('Migration Status', () => {
  let db: Database

  beforeEach(() => {
    db = new Database(':memory:')
    runMigrations(db, [migration001Initial])
    // Reset to pending state for each test
    db.run("DELETE FROM migration_status WHERE migration_name = 'linear_to_huly'")
    db.run("INSERT INTO migration_status (migration_name, status) VALUES ('linear_to_huly', 'pending')")
  })

  afterEach(() => {
    db.close()
  })

  it('should return pending status initially', () => {
    const status = getMigrationStatus('linear_to_huly', db)
    expect(status).toBe('pending')
  })

  it('should update status to in_progress', () => {
    setMigrationStatus('linear_to_huly', 'in_progress', undefined, db)
    const status = getMigrationStatus('linear_to_huly', db)
    expect(status).toBe('in_progress')
  })

  it('should update status to completed', () => {
    setMigrationStatus('linear_to_huly', 'completed', undefined, db)
    const status = getMigrationStatus('linear_to_huly', db)
    expect(status).toBe('completed')
  })

  it('should return false for isMigrationComplete when pending', () => {
    expect(isMigrationComplete('linear_to_huly', db)).toBe(false)
  })

  it('should return true for isMigrationComplete when completed', () => {
    setMigrationStatus('linear_to_huly', 'completed', undefined, db)
    expect(isMigrationComplete('linear_to_huly', db)).toBe(true)
  })

  it('should store error message on failure', () => {
    setMigrationStatus('linear_to_huly', 'failed', 'Linear API timeout', db)
    const row = db
      .query<{ error_message: string | null }, []>(
        "SELECT error_message FROM migration_status WHERE migration_name = 'linear_to_huly'",
      )
      .get()
    expect(row).not.toBeNull()
    expect(row?.error_message).toBe('Linear API timeout')
  })
})
