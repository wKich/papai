import { describe, expect, test, beforeEach, afterEach } from 'bun:test'

import { checkAuthorizationExtended } from '../src/bot.js'
import { addGroupMember } from '../src/groups.js'
import { addUser, isAuthorized } from '../src/users.js'
import { mockLogger, setupTestDb } from './utils/test-helpers.js'

describe('Authorization Logic', () => {
  beforeEach(async () => {
    mockLogger()
    await setupTestDb()
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

describe('Demo Mode Auto-Provision', () => {
  const DEMO_USER_ID = 'demo-user-1'
  const DEMO_USERNAME = 'demouser'

  beforeEach(async () => {
    mockLogger()
    await setupTestDb()
  })

  afterEach(() => {
    delete process.env['DEMO_MODE']
  })

  test('demo mode: unknown DM user is auto-added with non-admin auth', () => {
    process.env['DEMO_MODE'] = 'true'
    const result = checkAuthorizationExtended(DEMO_USER_ID, DEMO_USERNAME, DEMO_USER_ID, 'dm', false)
    expect(result).toEqual({
      allowed: true,
      isBotAdmin: false,
      isGroupAdmin: false,
      storageContextId: DEMO_USER_ID,
    })
    expect(isAuthorized(DEMO_USER_ID)).toBe(true)
  })

  test('demo mode: demo user stays non-admin on subsequent messages', () => {
    process.env['DEMO_MODE'] = 'true'
    // First message — auto-add
    checkAuthorizationExtended(DEMO_USER_ID, DEMO_USERNAME, DEMO_USER_ID, 'dm', false)
    // Second message — user already authorized
    const result = checkAuthorizationExtended(DEMO_USER_ID, DEMO_USERNAME, DEMO_USER_ID, 'dm', false)
    expect(result).toEqual({
      allowed: true,
      isBotAdmin: false,
      isGroupAdmin: false,
      storageContextId: DEMO_USER_ID,
    })
  })

  test('demo mode: unknown DM user without username is auto-added', () => {
    process.env['DEMO_MODE'] = 'true'
    const result = checkAuthorizationExtended(DEMO_USER_ID, null, DEMO_USER_ID, 'dm', false)
    expect(result.allowed).toBe(true)
    expect(result.isBotAdmin).toBe(false)
    expect(isAuthorized(DEMO_USER_ID)).toBe(true)
  })

  test('demo mode: manually-added user retains bot admin auth', () => {
    process.env['DEMO_MODE'] = 'true'
    addUser('manual-user', 'admin', 'manualuser')
    const result = checkAuthorizationExtended('manual-user', 'manualuser', 'manual-user', 'dm', false)
    expect(result.isBotAdmin).toBe(true)
  })

  test('demo mode: group messages from unknown users are NOT auto-added', () => {
    process.env['DEMO_MODE'] = 'true'
    const result = checkAuthorizationExtended('stranger-1', null, 'group-1', 'group', false)
    expect(result.allowed).toBe(false)
  })

  test('demo mode off: unknown DM user is NOT auto-added', () => {
    const result = checkAuthorizationExtended('stranger-1', 'stranger', 'stranger-1', 'dm', false)
    expect(result.allowed).toBe(false)
  })
})
