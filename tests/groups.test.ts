import { mock, describe, expect, test, beforeEach } from 'bun:test'

import { mockLogger, setupTestDb } from './utils/test-helpers.js'

// Setup logger mock at top of file
mockLogger()

// Mock getDrizzleDb to return our test database
let testDb: Awaited<ReturnType<typeof setupTestDb>>
void mock.module('../src/db/drizzle.js', () => ({
  getDrizzleDb: (): typeof testDb => testDb,
}))

import { addGroupMember, isGroupMember, listGroupMembers, removeGroupMember } from '../src/groups.js'

describe('groups', () => {
  beforeEach(async () => {
    testDb = await setupTestDb()
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
