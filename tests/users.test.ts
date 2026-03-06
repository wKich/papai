import { mock, describe, expect, test, beforeEach } from 'bun:test'

// --- Mock for db (must come before importing users.ts) ---
const store = {
  users: new Map<number, { telegram_id: number; username: string | null; added_at: string; added_by: number }>(),
}

class MockDatabase {
  run(sql: string, params?: (string | number)[]): void {
    if (sql.includes('INSERT INTO users') && params !== undefined) {
      if (sql.includes('ON CONFLICT(telegram_id) DO UPDATE')) {
        store.users.set(Number(params[0]), {
          telegram_id: Number(params[0]),
          username: String(params[1]),
          added_at: new Date().toISOString(),
          added_by: Number(params[2]),
        })
      } else if (!store.users.has(Number(params[0]))) {
        store.users.set(Number(params[0]), {
          telegram_id: Number(params[0]),
          username: null,
          added_at: new Date().toISOString(),
          added_by: Number(params[1]),
        })
      }
    }
    if (sql.includes('DELETE FROM users') && params !== undefined) {
      if (typeof params[0] === 'string') {
        for (const [id, user] of store.users) {
          if (user.username === params[0]) {
            store.users.delete(id)
            break
          }
        }
      } else {
        store.users.delete(Number(params[0]))
      }
    }
    if (sql.includes('UPDATE users SET telegram_id') && params !== undefined) {
      const newId = Number(params[0])
      const username = String(params[1])
      for (const [id, user] of store.users) {
        if (user.username === username) {
          store.users.delete(id)
          store.users.set(newId, { ...user, telegram_id: newId })
          break
        }
      }
    }
  }

  query(sql: string): {
    get: (...args: (string | number)[]) => Record<string, unknown> | null
    all: () => Array<Record<string, unknown>>
  } {
    if (sql.includes('SELECT telegram_id FROM users WHERE telegram_id')) {
      return {
        get: (id: string | number): Record<string, unknown> | null => {
          const user = store.users.get(Number(id))
          return user === undefined ? null : { telegram_id: user.telegram_id }
        },
        all: (): Array<Record<string, unknown>> => [],
      }
    }
    if (sql.includes('SELECT telegram_id FROM users WHERE username')) {
      return {
        get: (username: string | number): Record<string, unknown> | null => {
          for (const user of store.users.values()) {
            if (user.username === username) {
              return { telegram_id: user.telegram_id }
            }
          }
          return null
        },
        all: (): Array<Record<string, unknown>> => [],
      }
    }
    if (sql.includes('SELECT telegram_id, username, added_at, added_by FROM users')) {
      return {
        get: (): null => null,
        all: (): Array<Record<string, unknown>> => Array.from(store.users.values()),
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

import {
  addUser,
  removeUser,
  isAuthorized,
  isAuthorizedByUsername,
  resolveUserByUsername,
  listUsers,
} from '../src/users.js'

describe('addUser', () => {
  beforeEach(() => {
    store.users.clear()
  })

  test('adds a user by ID', () => {
    addUser(111, 999)
    expect(store.users.has(111)).toBe(true)
    expect(store.users.get(111)?.added_by).toBe(999)
    expect(store.users.get(111)?.username).toBeNull()
  })

  test('adds a user with username', () => {
    addUser(111, 999, 'testuser')
    expect(store.users.has(111)).toBe(true)
    expect(store.users.get(111)?.username).toBe('testuser')
    expect(store.users.get(111)?.added_by).toBe(999)
  })

  test('does not overwrite existing user when adding by ID', () => {
    addUser(111, 999)
    addUser(111, 888)
    expect(store.users.get(111)?.added_by).toBe(999)
  })
})

describe('removeUser', () => {
  beforeEach(() => {
    store.users.clear()
  })

  test('removes a user by ID', () => {
    addUser(111, 999)
    removeUser(111)
    expect(store.users.has(111)).toBe(false)
  })

  test('removes a user by username', () => {
    addUser(111, 999, 'testuser')
    removeUser('testuser')
    expect(store.users.has(111)).toBe(false)
  })
})

describe('isAuthorized', () => {
  beforeEach(() => {
    store.users.clear()
  })

  test('returns true for authorized user', () => {
    addUser(111, 999)
    expect(isAuthorized(111)).toBe(true)
  })

  test('returns false for unknown user', () => {
    expect(isAuthorized(222)).toBe(false)
  })
})

describe('isAuthorizedByUsername', () => {
  beforeEach(() => {
    store.users.clear()
  })

  test('returns true for authorized user by username', () => {
    addUser(111, 999, 'testuser')
    expect(isAuthorizedByUsername('testuser')).toBe(true)
  })

  test('returns false for unknown username', () => {
    expect(isAuthorizedByUsername('unknown')).toBe(false)
  })
})

describe('resolveUserByUsername', () => {
  beforeEach(() => {
    store.users.clear()
  })

  test('resolves placeholder ID to real telegram ID', () => {
    addUser(-100, 999, 'alice')
    expect(resolveUserByUsername(555, 'alice')).toBe(true)
    expect(store.users.has(555)).toBe(true)
    expect(store.users.has(-100)).toBe(false)
  })

  test('returns true when ID already matches', () => {
    addUser(555, 999, 'alice')
    expect(resolveUserByUsername(555, 'alice')).toBe(true)
  })

  test('returns false for unknown username', () => {
    expect(resolveUserByUsername(555, 'unknown')).toBe(false)
  })
})

describe('listUsers', () => {
  beforeEach(() => {
    store.users.clear()
  })

  test('returns all users', () => {
    addUser(111, 999)
    addUser(222, 999)
    const users = listUsers()
    expect(users).toHaveLength(2)
  })

  test('returns empty array when no users', () => {
    expect(listUsers()).toHaveLength(0)
  })

  test('includes username when set', () => {
    addUser(111, 999, 'testuser')
    const users = listUsers()
    expect(users[0]?.username).toBe('testuser')
  })
})
