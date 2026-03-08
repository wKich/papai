import { Database } from 'bun:sqlite'
import { describe, it, expect, beforeAll, afterAll } from 'bun:test'

import { runMigrations } from '../../src/db/migrate.js'
import { migration001Initial } from '../../src/db/migrations/001_initial.js'

describe('Database migrations', () => {
  let db: Database

  beforeAll(() => {
    db = new Database(':memory:')
    runMigrations(db, [migration001Initial])
  })

  afterAll(() => {
    db.close()
  })

  it('should have migration_status table', () => {
    const table = db.query("SELECT name FROM sqlite_master WHERE type='table' AND name='migration_status'").get()
    expect(table).toBeDefined()
  })

  it('should track linear migration status', () => {
    type CountResult = { count: number }
    const result = db
      .query<CountResult, []>("SELECT COUNT(*) as count FROM migration_status WHERE migration_name = 'linear_to_huly'")
      .get()
    expect(result?.count).toBe(1)
  })
})
