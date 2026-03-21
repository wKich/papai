import { mock, describe, expect, test, beforeEach } from 'bun:test'

import { eq } from 'drizzle-orm'

import * as schema from '../src/db/schema.js'
import { mockLogger, setupTestDb } from './utils/test-helpers.js'

// Setup logger mock at top of file
mockLogger()

// Mock getDrizzleDb to return our test database
let testDb: Awaited<ReturnType<typeof setupTestDb>>
void mock.module('../src/db/drizzle.js', () => ({
  getDrizzleDb: (): typeof testDb => testDb,
}))

import { addUser, removeUser, isAuthorized, resolveUserByUsername, listUsers } from '../src/users.js'

describe('addUser', () => {
  beforeEach(async () => {
    testDb = await setupTestDb()
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
  beforeEach(async () => {
    testDb = await setupTestDb()
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
  beforeEach(async () => {
    testDb = await setupTestDb()
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
  beforeEach(async () => {
    testDb = await setupTestDb()
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
  beforeEach(async () => {
    testDb = await setupTestDb()
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
