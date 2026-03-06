import { mock, describe, expect, test, beforeEach } from 'bun:test'

// --- Mock for db (must come before importing migrate.ts) ---
const store = {
  configRows: new Map<string, string>(),
  userConfigRows: new Map<string, string>(),
  users: new Map<number, boolean>(),
  tableExists: true,
}

class MockDatabase {
  run(sql: string, params?: (string | number)[]): void {
    if (sql.includes('INSERT INTO users') && params !== undefined) {
      if (!store.users.has(Number(params[0]))) {
        store.users.set(Number(params[0]), true)
      }
    }
    if (sql.includes('INSERT OR IGNORE INTO user_config') && params !== undefined) {
      const key = `${params[0]}:${params[1]}`
      if (!store.userConfigRows.has(key)) {
        store.userConfigRows.set(key, String(params[2]))
      }
    }
  }

  query(sql: string): {
    get: () => Record<string, unknown> | null
    all: () => Array<Record<string, unknown>>
  } {
    if (sql.includes('sqlite_master') && sql.includes("name='config'")) {
      return {
        get: (): Record<string, unknown> | null => (store.tableExists ? { name: 'config' } : null),
        all: (): Array<Record<string, unknown>> => [],
      }
    }
    if (sql.includes('SELECT key, value FROM config')) {
      return {
        get: (): null => null,
        all: (): Array<Record<string, unknown>> =>
          Array.from(store.configRows.entries()).map(([key, value]) => ({ key, value })),
      }
    }
    return { get: (): null => null, all: (): Array<Record<string, unknown>> => [] }
  }
}

const mockDb = new MockDatabase()

void mock.module('../src/db/index.js', () => ({
  getDb: (): MockDatabase => mockDb,
  DB_PATH: ':memory:',
  initDb: (): void => {},
}))

import { migrateToMultiUser } from '../src/migrate.js'

describe('migrateToMultiUser', () => {
  beforeEach(() => {
    store.configRows.clear()
    store.userConfigRows.clear()
    store.users.clear()
    store.tableExists = true
  })

  test('seeds admin user', () => {
    migrateToMultiUser(12345)
    expect(store.users.has(12345)).toBe(true)
  })

  test('migrates existing config rows to admin user_config', () => {
    store.configRows.set('linear_key', 'lin_xxx')
    store.configRows.set('openai_model', 'gpt-4o')
    migrateToMultiUser(12345)
    expect(store.userConfigRows.get('12345:linear_key')).toBe('lin_xxx')
    expect(store.userConfigRows.get('12345:openai_model')).toBe('gpt-4o')
  })

  test('skips migration when config table does not exist', () => {
    store.tableExists = false
    migrateToMultiUser(12345)
    expect(store.userConfigRows.size).toBe(0)
  })

  test('does not overwrite existing user_config', () => {
    store.userConfigRows.set('12345:linear_key', 'existing')
    store.configRows.set('linear_key', 'old-value')
    migrateToMultiUser(12345)
    expect(store.userConfigRows.get('12345:linear_key')).toBe('existing')
  })

  test('is idempotent — running twice does not duplicate', () => {
    store.configRows.set('linear_key', 'lin_xxx')
    migrateToMultiUser(12345)
    migrateToMultiUser(12345)
    expect(store.users.has(12345)).toBe(true)
    expect(store.userConfigRows.get('12345:linear_key')).toBe('lin_xxx')
  })
})
