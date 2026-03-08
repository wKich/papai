import { describe, it, expect, beforeEach, afterAll } from 'bun:test'

import { closeDb } from '../../src/db/index.js'
import { runMigrations } from '../../src/db/migrate.js'
import { setMigrationStatus } from '../../src/db/migration-status.js'
import { runLinearToHulyMigration } from '../../src/migration/migrate.js'

describe('Migration Engine', () => {
  beforeEach(() => {
    runMigrations()
    setMigrationStatus('linear_to_huly', 'pending')
  })

  afterAll(() => {
    closeDb()
  })

  it('should be defined', () => {
    expect(typeof runLinearToHulyMigration).toBe('function')
  })

  it('should skip if migration already completed', async () => {
    setMigrationStatus('linear_to_huly', 'completed')
    // Should not throw
    await runLinearToHulyMigration()
  })
})
