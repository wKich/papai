import { Database } from 'bun:sqlite'
import { mock, describe, expect, test, beforeEach } from 'bun:test'

import { eq } from 'drizzle-orm'
import { drizzle } from 'drizzle-orm/bun-sqlite'

import * as schema from '../src/db/schema.js'

// --- Test database setup with Drizzle ---
let testDb: ReturnType<typeof drizzle<typeof schema>>
let testSqlite: Database

// Mock getDrizzleDb to return our test database
void mock.module('../src/db/drizzle.js', () => ({
  getDrizzleDb: (): ReturnType<typeof drizzle<typeof schema>> => testDb,
}))

import { addUser, removeUser, isAuthorized, resolveUserByUsername, listUsers } from '../src/users.js'

describe('addUser', () => {
  beforeEach(() => {
    testSqlite = new Database(':memory:')
    testDb = drizzle(testSqlite, { schema })
    // Create tables using Drizzle's schema
    testSqlite.run(`
      CREATE TABLE users (
        platform_user_id TEXT PRIMARY KEY,
        username TEXT UNIQUE,
        added_at TEXT NOT NULL DEFAULT (datetime('now')),
        added_by TEXT NOT NULL,
        kaneo_workspace_id TEXT
      )
    `)
  })

  test('adds a user by ID', () => {
    addUser('111', '999')
    const user = testDb.select().from(schema.users).where(eq(schema.users.platformUserId, '111')).get()
    expect(user).toBeDefined()
    expect(user?.addedBy).toBe('999')
    expect(user?.username).toBeNull()
  })

  test('adds a user with username', () => {
    addUser('111', '999', 'testuser')
    const user = testDb.select().from(schema.users).where(eq(schema.users.platformUserId, '111')).get()
    expect(user).toBeDefined()
    expect(user?.username).toBe('testuser')
    expect(user?.addedBy).toBe('999')
  })

  test('does not overwrite existing user when adding by ID', () => {
    addUser('111', '999')
    addUser('111', '888')
    const user = testDb.select().from(schema.users).where(eq(schema.users.platformUserId, '111')).get()
    expect(user?.addedBy).toBe('999')
  })
})

describe('removeUser', () => {
  beforeEach(() => {
    testSqlite = new Database(':memory:')
    testDb = drizzle(testSqlite, { schema })
    testSqlite.run(`
      CREATE TABLE users (
        platform_user_id TEXT PRIMARY KEY,
        username TEXT UNIQUE,
        added_at TEXT NOT NULL DEFAULT (datetime('now')),
        added_by TEXT NOT NULL,
        kaneo_workspace_id TEXT
      )
    `)
  })

  test('removes a user by ID', () => {
    addUser('111', '999')
    removeUser('111')
    const user = testDb.select().from(schema.users).where(eq(schema.users.platformUserId, '111')).get()
    expect(user).toBeUndefined()
  })

  test('removes a user by username', () => {
    addUser('111', '999', 'testuser')
    removeUser('testuser')
    const user = testDb.select().from(schema.users).where(eq(schema.users.platformUserId, '111')).get()
    expect(user).toBeUndefined()
  })
})

describe('isAuthorized', () => {
  beforeEach(() => {
    testSqlite = new Database(':memory:')
    testDb = drizzle(testSqlite, { schema })
    testSqlite.run(`
      CREATE TABLE users (
        platform_user_id TEXT PRIMARY KEY,
        username TEXT UNIQUE,
        added_at TEXT NOT NULL DEFAULT (datetime('now')),
        added_by TEXT NOT NULL,
        kaneo_workspace_id TEXT
      )
    `)
  })

  test('returns true for authorized user', () => {
    addUser('111', '999')
    expect(isAuthorized('111')).toBe(true)
  })

  test('returns false for unknown user', () => {
    expect(isAuthorized('222')).toBe(false)
  })
})

describe('resolveUserByUsername', () => {
  beforeEach(() => {
    testSqlite = new Database(':memory:')
    testDb = drizzle(testSqlite, { schema })
    testSqlite.run(`
      CREATE TABLE users (
        platform_user_id TEXT PRIMARY KEY,
        username TEXT UNIQUE,
        added_at TEXT NOT NULL DEFAULT (datetime('now')),
        added_by TEXT NOT NULL,
        kaneo_workspace_id TEXT
      )
    `)
  })

  test('resolves placeholder ID to real platform user ID', () => {
    addUser('placeholder-abc', '999', 'alice')
    expect(resolveUserByUsername('555', 'alice')).toBe(true)
    const user = testDb.select().from(schema.users).where(eq(schema.users.platformUserId, '555')).get()
    expect(user).toBeDefined()
    const oldUser = testDb.select().from(schema.users).where(eq(schema.users.platformUserId, 'placeholder-abc')).get()
    expect(oldUser).toBeUndefined()
  })

  test('returns true when ID already matches', () => {
    addUser('555', '999', 'alice')
    expect(resolveUserByUsername('555', 'alice')).toBe(true)
  })

  test('returns false for unknown username', () => {
    expect(resolveUserByUsername('555', 'unknown')).toBe(false)
  })
})

describe('listUsers', () => {
  beforeEach(() => {
    testSqlite = new Database(':memory:')
    testDb = drizzle(testSqlite, { schema })
    testSqlite.run(`
      CREATE TABLE users (
        platform_user_id TEXT PRIMARY KEY,
        username TEXT UNIQUE,
        added_at TEXT NOT NULL DEFAULT (datetime('now')),
        added_by TEXT NOT NULL,
        kaneo_workspace_id TEXT
      )
    `)
  })

  test('returns all users', () => {
    addUser('111', '999')
    addUser('222', '999')
    const users = listUsers()
    expect(users).toHaveLength(2)
  })

  test('returns empty array when no users', () => {
    expect(listUsers()).toHaveLength(0)
  })

  test('includes username when set', () => {
    addUser('111', '999', 'testuser')
    const users = listUsers()
    expect(users[0]?.username).toBe('testuser')
  })
})
