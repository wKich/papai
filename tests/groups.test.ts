import { Database } from 'bun:sqlite'
import { mock, describe, expect, test, beforeEach } from 'bun:test'

import { drizzle } from 'drizzle-orm/bun-sqlite'

import * as schema from '../src/db/schema.js'

// --- Test database setup with Drizzle ---
let testDb: ReturnType<typeof drizzle<typeof schema>>
let testSqlite: Database

// Mock getDrizzleDb to return our test database
void mock.module('../src/db/drizzle.js', () => ({
  getDrizzleDb: (): ReturnType<typeof drizzle<typeof schema>> => testDb,
}))

import { addGroupMember, isGroupMember, listGroupMembers, removeGroupMember } from '../src/groups.js'

describe('groups', () => {
  beforeEach(() => {
    testSqlite = new Database(':memory:')
    testDb = drizzle(testSqlite, { schema })
    // Create group_members table using Drizzle's schema
    testSqlite.run(`
      CREATE TABLE group_members (
        group_id TEXT NOT NULL,
        user_id TEXT NOT NULL,
        added_by TEXT NOT NULL,
        added_at TEXT NOT NULL DEFAULT (datetime('now')),
        PRIMARY KEY (group_id, user_id)
      )
    `)
  })

  test('addGroupMember adds member to group', () => {
    addGroupMember('group1', 'user1', 'admin1')
    expect(isGroupMember('group1', 'user1')).toBe(true)
  })

  test('isGroupMember returns false for non-member', () => {
    expect(isGroupMember('group1', 'user2')).toBe(false)
  })

  test('removeGroupMember removes member', () => {
    addGroupMember('group1', 'user1', 'admin1')
    removeGroupMember('group1', 'user1')
    expect(isGroupMember('group1', 'user1')).toBe(false)
  })

  test('listGroupMembers returns all members', () => {
    addGroupMember('group1', 'user1', 'admin1')
    addGroupMember('group1', 'user2', 'admin1')
    const members = listGroupMembers('group1')
    expect(members).toHaveLength(2)
    expect(members.map((m) => m.user_id).sort()).toEqual(['user1', 'user2'])
  })

  test('addGroupMember is no-op for duplicate member', () => {
    addGroupMember('group1', 'user1', 'admin1')
    addGroupMember('group1', 'user1', 'admin1')
    const members = listGroupMembers('group1')
    expect(members).toHaveLength(1)
  })

  test('listGroupMembers returns added_by and added_at', () => {
    addGroupMember('group1', 'user1', 'admin1')
    const members = listGroupMembers('group1')
    expect(members[0]).toHaveProperty('user_id', 'user1')
    expect(members[0]).toHaveProperty('added_by', 'admin1')
    expect(members[0]).toHaveProperty('added_at')
  })

  test('listGroupMembers returns empty array for unknown group', () => {
    const members = listGroupMembers('unknown-group')
    expect(members).toHaveLength(0)
  })

  test('removeGroupMember is no-op for non-member', () => {
    // Should not throw
    removeGroupMember('group1', 'nonexistent')
  })
})
