import { describe, expect, test, beforeEach } from 'bun:test'

import { checkAuthorizationExtended, getThreadScopedStorageContextId } from '../src/auth.js'
import { addGroupMember } from '../src/groups.js'
import { addUser } from '../src/users.js'
import { mockLogger, setupTestDb } from './utils/test-helpers.js'

describe('auth', () => {
  beforeEach(async () => {
    mockLogger()
    await setupTestDb()
  })

  describe('getThreadScopedStorageContextId', () => {
    test('returns userId for DM context', () => {
      const result = getThreadScopedStorageContextId('user123', 'dm', undefined)
      expect(result).toBe('user123')
    })

    test('returns groupId for main chat (no thread)', () => {
      const result = getThreadScopedStorageContextId('group456', 'group', undefined)
      expect(result).toBe('group456')
    })

    test('returns groupId:threadId for thread', () => {
      const result = getThreadScopedStorageContextId('group456', 'group', 'thread789')
      expect(result).toBe('group456:thread789')
    })
  })

  describe('checkAuthorizationExtended', () => {
    describe('bot admin in group', () => {
      test('configContextId equals storageContextId in main chat', () => {
        addUser('admin1', 'admin1')
        addGroupMember('group1', 'admin1', 'admin1')

        const groupAuth = checkAuthorizationExtended('admin1', null, 'group1', 'group', undefined, false)

        expect(groupAuth.allowed).toBe(true)
        expect(groupAuth.isBotAdmin).toBe(true)
        expect(groupAuth.configContextId).toBe('group1')
        expect(groupAuth.configContextId).toBe(groupAuth.storageContextId)
      })

      test('thread-scoped storageContextId with group-scoped configContextId', () => {
        addUser('admin1', 'admin1')
        addGroupMember('group1', 'admin1', 'admin1')

        const threadAuth = checkAuthorizationExtended('admin1', null, 'group1', 'group', 'thread123', false)

        expect(threadAuth.allowed).toBe(true)
        expect(threadAuth.isBotAdmin).toBe(true)
        expect(threadAuth.storageContextId).toBe('group1:thread123')
        expect(threadAuth.configContextId).toBe('group1')
      })

      test('isGroupAdmin reflects platform admin status', () => {
        addUser('admin1', 'admin1')
        addGroupMember('group1', 'admin1', 'admin1')

        const nonAdminAuth = checkAuthorizationExtended('admin1', null, 'group1', 'group', undefined, false)
        expect(nonAdminAuth.isGroupAdmin).toBe(false)

        const adminAuth = checkAuthorizationExtended('admin1', null, 'group1', 'group', undefined, true)
        expect(adminAuth.isGroupAdmin).toBe(true)
      })
    })

    describe('group member (non-admin)', () => {
      test('has correct auth flags', () => {
        // Add to group WITHOUT adding as authorized user (group member only)
        addGroupMember('group1', 'user1', 'user1')

        const memberAuth = checkAuthorizationExtended('user1', null, 'group1', 'group', undefined, false)

        expect(memberAuth.allowed).toBe(true)
        expect(memberAuth.isBotAdmin).toBe(false)
        expect(memberAuth.isGroupAdmin).toBe(false)
        expect(memberAuth.configContextId).toBe('group1')
      })

      test('in thread has isolated storage but shared config', () => {
        // Add to group WITHOUT adding as authorized user (group member only)
        addGroupMember('group1', 'user1', 'user1')

        const threadAuth = checkAuthorizationExtended('user1', null, 'group1', 'group', 'thread456', false)

        expect(threadAuth.allowed).toBe(true)
        expect(threadAuth.isBotAdmin).toBe(false)
        expect(threadAuth.storageContextId).toBe('group1:thread456')
        expect(threadAuth.configContextId).toBe('group1')
      })
    })

    describe('unauthorized user in group', () => {
      test('has correct auth flags with group-scoped config', () => {
        const unauthorizedAuth = checkAuthorizationExtended('stranger1', null, 'group1', 'group', undefined, false)

        expect(unauthorizedAuth.allowed).toBe(false)
        expect(unauthorizedAuth.isBotAdmin).toBe(false)
        expect(unauthorizedAuth.isGroupAdmin).toBe(false)
        expect(unauthorizedAuth.storageContextId).toBe('group1')
        expect(unauthorizedAuth.configContextId).toBe('group1')
      })
    })

    describe('DM user', () => {
      test('authorized user has full access with matching context IDs', () => {
        addUser('user1', 'user1')

        const dmAuth = checkAuthorizationExtended('user1', null, 'user1', 'dm', undefined, false)

        expect(dmAuth.allowed).toBe(true)
        expect(dmAuth.isBotAdmin).toBe(true)
        expect(dmAuth.isGroupAdmin).toBe(false)
        expect(dmAuth.storageContextId).toBe('user1')
        expect(dmAuth.configContextId).toBe('user1')
      })

      test('unauthorized user has no access but gets context IDs', () => {
        const unauthorizedDmAuth = checkAuthorizationExtended('stranger1', null, 'stranger1', 'dm', undefined, false)

        expect(unauthorizedDmAuth.allowed).toBe(false)
        expect(unauthorizedDmAuth.isBotAdmin).toBe(false)
        expect(unauthorizedDmAuth.isGroupAdmin).toBe(false)
        expect(unauthorizedDmAuth.storageContextId).toBe('stranger1')
        expect(unauthorizedDmAuth.configContextId).toBe('stranger1')
      })

      test('user resolved by username gets access', () => {
        // First add a user with a username
        addUser('realuser1', 'admin1', 'realuser1')
        // Then check that the username resolves to the user
        const resolvedAuth = checkAuthorizationExtended('stranger1', 'realuser1', 'stranger1', 'dm', undefined, false)

        expect(resolvedAuth.allowed).toBe(true)
        expect(resolvedAuth.isBotAdmin).toBe(true)
        expect(resolvedAuth.configContextId).toBe('stranger1')
      })
    })
  })
})
