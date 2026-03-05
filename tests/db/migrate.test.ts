import { Database } from 'bun:sqlite'
import { describe, test, expect, beforeEach } from 'bun:test'

import { runMigrations, type Migration } from '../../src/db/migrate.js'

describe('runMigrations', () => {
  let db: Database

  beforeEach(() => {
    db = new Database(':memory:')
  })

  test('applies pending migrations in order', () => {
    const executionOrder: string[] = []

    const migrations: readonly Migration[] = [
      {
        id: '001_first',
        up: (database: Database) => {
          executionOrder.push('001_first')
          database.run('CREATE TABLE IF NOT EXISTS test_table_1 (id INTEGER PRIMARY KEY)')
        },
      },
      {
        id: '002_second',
        up: (database: Database) => {
          executionOrder.push('002_second')
          database.run('CREATE TABLE IF NOT EXISTS test_table_2 (id INTEGER PRIMARY KEY)')
        },
      },
    ]

    runMigrations(db, migrations)

    expect(executionOrder).toEqual(['001_first', '002_second'])

    const tables = db
      .query<{ name: string }, []>("SELECT name FROM sqlite_master WHERE type='table' AND name LIKE 'test_table_%'")
      .all()
    const tableNames = tables.map((t) => t.name).sort()
    expect(tableNames).toEqual(['test_table_1', 'test_table_2'])

    const migrationIds = db
      .query<{ id: string }, []>('SELECT id FROM migrations ORDER BY applied_at')
      .all()
      .map((row) => row.id)
    expect(migrationIds).toEqual(['001_first', '002_second'])
  })

  test('skips already-applied migrations', () => {
    let firstCallCount = 0
    let secondCallCount = 0

    const migrations: readonly Migration[] = [
      {
        id: '001_first',
        up: () => {
          firstCallCount++
        },
      },
      {
        id: '002_second',
        up: () => {
          secondCallCount++
        },
      },
    ]

    db.run('CREATE TABLE IF NOT EXISTS migrations (id TEXT PRIMARY KEY, applied_at TEXT NOT NULL)')
    db.run("INSERT INTO migrations (id, applied_at) VALUES ('001_first', ?)", [new Date().toISOString()])

    runMigrations(db, migrations)

    expect(firstCallCount).toBe(0)
    expect(secondCallCount).toBe(1)

    const migrationIds = db
      .query<{ id: string }, []>('SELECT id FROM migrations')
      .all()
      .map((row) => row.id)
    expect(migrationIds).toContain('001_first')
    expect(migrationIds).toContain('002_second')
    expect(migrationIds).toHaveLength(2)
  })

  test('rolls back on failure and rethrows', () => {
    let sideEffectVisible = false

    const migrations: readonly Migration[] = [
      {
        id: '001_will_fail',
        up: (database: Database) => {
          database.run('CREATE TABLE IF NOT EXISTS temp_table (id INTEGER PRIMARY KEY)')
          sideEffectVisible = true
          throw new Error('Migration failed intentionally')
        },
      },
    ]

    expect(() =>{  runMigrations(db, migrations); }).toThrow('Migration failed intentionally')

    expect(sideEffectVisible).toBe(true)

    const tableExists = db
      .query<{ count: number }, []>(
        "SELECT COUNT(*) as count FROM sqlite_master WHERE type='table' AND name='temp_table'",
      )
      .get()
    expect(tableExists?.count).toBe(0)

    const migrationExists = db
      .query<{ count: number }, []>("SELECT COUNT(*) as count FROM migrations WHERE id='001_will_fail'")
      .get()
    expect(migrationExists?.count).toBe(0)
  })

  test('is idempotent - second call applies nothing', () => {
    let callCount = 0

    const migrations: readonly Migration[] = [
      {
        id: '001_once',
        up: () => {
          callCount++
        },
      },
    ]

    runMigrations(db, migrations)
    expect(callCount).toBe(1)

    runMigrations(db, migrations)
    expect(callCount).toBe(1)

    const migrationCount = db.query<{ count: number }, []>('SELECT COUNT(*) as count FROM migrations').get()
    expect(migrationCount?.count).toBe(1)
  })

  test('handles empty migration list', () => {
    expect(() =>{  runMigrations(db, []); }).not.toThrow()

    const tableExists = db
      .query<{ count: number }, []>(
        "SELECT COUNT(*) as count FROM sqlite_master WHERE type='table' AND name='migrations'",
      )
      .get()
    expect(tableExists?.count).toBe(1)

    const migrationCount = db.query<{ count: number }, []>('SELECT COUNT(*) as count FROM migrations').get()
    expect(migrationCount?.count).toBe(0)
  })
})
