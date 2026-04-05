import { describe, expect, test, beforeEach } from 'bun:test'

import { checkAuthorizationExtended } from '../src/bot.js'
import { addGroupMember } from '../src/groups.js'
import { addUser } from '../src/users.js'
import { mockLogger, setupTestDb } from './utils/test-helpers.js'

describe('group context isolation', () => {
  beforeEach(async () => {
    mockLogger()
    await setupTestDb()
  })

  test('two groups have independent storage contexts', () => {
    // Add members to two different groups
    addUser('user1', 'admin1')
    addGroupMember('group1', 'user1', 'admin1')
    addGroupMember('group2', 'user1', 'admin1')

    // Verify storageContextId is different for each
    const group1Auth = checkAuthorizationExtended('user1', null, 'group1', 'group', false)
    const group2Auth = checkAuthorizationExtended('user1', null, 'group2', 'group', false)

    expect(group1Auth.storageContextId).toBe('group1')
    expect(group2Auth.storageContextId).toBe('group2')
    expect(group1Auth.storageContextId).not.toBe(group2Auth.storageContextId)
  })

  test('dm uses userId as storage context', () => {
    addUser('admin1', 'admin1')
    const dmAuth = checkAuthorizationExtended('admin1', null, 'admin1', 'dm', false)
    expect(dmAuth.storageContextId).toBe('admin1')
  })

  test('unauthorized user in group still gets correct storage context', () => {
    // Don't add user1 to authorized users or group members
    const groupAuth = checkAuthorizationExtended('user1', null, 'group1', 'group', false)

    // Should not be allowed but storageContextId should still be group1
    expect(groupAuth.allowed).toBe(false)
    expect(groupAuth.storageContextId).toBe('group1')
  })

  test('bot admin in group uses groupId as storage context', () => {
    // Add admin as authorized user
    addUser('admin1', 'admin1')
    addGroupMember('group1', 'admin1', 'admin1')

    const groupAuth = checkAuthorizationExtended('admin1', null, 'group1', 'group', false)

    expect(groupAuth.allowed).toBe(true)
    expect(groupAuth.isBotAdmin).toBe(true)
    expect(groupAuth.storageContextId).toBe('group1')
  })
})
