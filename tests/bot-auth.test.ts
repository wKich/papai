import { mock, describe, expect, test, beforeEach } from 'bun:test'

import { mockLogger, setupTestDb } from './utils/test-helpers.js'

// Setup logger mock at top of file
mockLogger()

// Mock getDrizzleDb to return our test database
let testDb: Awaited<ReturnType<typeof setupTestDb>>

void mock.module('../src/db/drizzle.js', () => ({
  getDrizzleDb: (): typeof testDb => testDb,
}))

// Mock commands/index.js to avoid Grammy imports
void mock.module('../src/commands/index.js', () => ({
  registerHelpCommand: (): void => {},
  registerSetCommand: (): void => {},
  registerConfigCommand: (): void => {},
  registerContextCommand: (): void => {},
  registerClearCommand: (): void => {},
  registerAdminCommands: (): void => {},
  registerGroupCommand: (): void => {},
}))

// Mock llm-orchestrator to avoid its transitive imports
void mock.module('../src/llm-orchestrator.js', () => ({
  processMessage: (): Promise<void> => Promise.resolve(),
}))

import { checkAuthorizationExtended } from '../src/bot.js'
import { addGroupMember } from '../src/groups.js'
import { addUser } from '../src/users.js'

describe('Authorization Logic', () => {
  beforeEach(async () => {
    testDb = await setupTestDb()
  })

  describe('Bot Admin Authorization', () => {
    test('Bot admin in DM → allowed with isBotAdmin, storageContextId=userId', () => {
      addUser('admin-1', 'system', 'admin')

      const result = checkAuthorizationExtended('admin-1', 'admin', 'admin-1', 'dm', false)
      expect(result).toEqual({
        allowed: true,
        isBotAdmin: true,
        isGroupAdmin: false,
        storageContextId: 'admin-1',
      })
    })

    test('Bot admin in group → allowed with isBotAdmin, storageContextId=groupId', () => {
      addUser('admin-1', 'system', 'admin')

      const result = checkAuthorizationExtended('admin-1', 'admin', 'group-1', 'group', false)
      expect(result).toEqual({
        allowed: true,
        isBotAdmin: true,
        isGroupAdmin: false,
        storageContextId: 'group-1',
      })
    })

    test('Bot admin who is also platform admin → isGroupAdmin=true', () => {
      addUser('admin-1', 'system', 'admin')

      const result = checkAuthorizationExtended('admin-1', 'admin', 'group-1', 'group', true)
      expect(result).toEqual({
        allowed: true,
        isBotAdmin: true,
        isGroupAdmin: true,
        storageContextId: 'group-1',
      })
    })
  })

  describe('Group Member Authorization', () => {
    test('Group member → allowed, not bot admin, storageContextId=groupId', () => {
      addGroupMember('group-1', 'member-1', 'system')

      const result = checkAuthorizationExtended('member-1', null, 'group-1', 'group', false)
      expect(result).toEqual({
        allowed: true,
        isBotAdmin: false,
        isGroupAdmin: false,
        storageContextId: 'group-1',
      })
    })

    test('Group member who is platform admin → isGroupAdmin=true', () => {
      addGroupMember('group-1', 'member-1', 'system')

      const result = checkAuthorizationExtended('member-1', null, 'group-1', 'group', true)
      expect(result).toEqual({
        allowed: true,
        isBotAdmin: false,
        isGroupAdmin: true,
        storageContextId: 'group-1',
      })
    })

    test('Non-member in group → not allowed', () => {
      const result = checkAuthorizationExtended('stranger-1', null, 'group-1', 'group', false)
      expect(result).toEqual({
        allowed: false,
        isBotAdmin: false,
        isGroupAdmin: false,
        storageContextId: 'group-1',
      })
    })
  })

  describe('DM User Resolution by Username', () => {
    test('DM user resolved by username → allowed, storageContextId=userId', () => {
      addUser('placeholder-id', 'system', 'alice')

      const result = checkAuthorizationExtended('real-alice-id', 'alice', 'real-alice-id', 'dm', false)
      expect(result).toEqual({
        allowed: true,
        isBotAdmin: true,
        isGroupAdmin: false,
        storageContextId: 'real-alice-id',
      })
    })

    test('DM user with unmatched username → not allowed', () => {
      const result = checkAuthorizationExtended('unknown-id', 'bob', 'unknown-id', 'dm', false)
      expect(result).toEqual({
        allowed: false,
        isBotAdmin: false,
        isGroupAdmin: false,
        storageContextId: 'unknown-id',
      })
    })
  })

  describe('Priority: Bot Admin Wins Over Group Check', () => {
    test('User who is BOTH bot admin AND group member → returns bot admin result (isBotAdmin=true)', () => {
      addUser('admin-1', 'system', 'admin')
      addGroupMember('group-1', 'admin-1', 'system')

      const result = checkAuthorizationExtended('admin-1', 'admin', 'group-1', 'group', false)
      expect(result).toEqual({
        allowed: true,
        isBotAdmin: true,
        isGroupAdmin: false,
        storageContextId: 'group-1',
      })
    })
  })
})
