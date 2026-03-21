import { beforeEach, describe, expect, mock, test } from 'bun:test'

import type { ChatProvider, CommandHandler } from '../../src/chat/types.js'
import { registerAdminCommands } from '../../src/commands/admin.js'
import * as schema from '../../src/db/schema.js'
import { addUser, isAuthorized, listUsers } from '../../src/users.js'
import {
  createDmMessage,
  createMockReply,
  getTestDb,
  mockDrizzle,
  mockLogger,
  setupTestDb,
} from '../utils/test-helpers.js'

// Mock logger at top of file
mockLogger()

// Mock getDrizzleDb BEFORE importing source modules
mockDrizzle()

// Mock provisionAndConfigure to bypass Kaneo HTTP calls
void mock.module('../../src/providers/kaneo/provision.js', () => ({
  provisionAndConfigure: (): Promise<{ status: string }> => Promise.resolve({ status: 'skipped' }),
}))

const ADMIN_ID = 'admin-001'

describe('Admin Commands', () => {
  let commandHandlers: Map<string, CommandHandler>

  beforeEach(async () => {
    await setupTestDb()

    // Add admin user to DB
    addUser(ADMIN_ID, ADMIN_ID)

    commandHandlers = new Map()
    const mockChat: ChatProvider = {
      name: 'mock',
      registerCommand: (name: string, handler: CommandHandler): void => {
        commandHandlers.set(name, handler)
      },
      onMessage: (): void => {},
      sendMessage: (): Promise<void> => Promise.resolve(),
      start: (): Promise<void> => Promise.resolve(),
      stop: (): Promise<void> => Promise.resolve(),
    }
    registerAdminCommands(mockChat, ADMIN_ID)
  })

  describe('/user add', () => {
    test('adds user by numeric ID and confirms', async () => {
      const handler = commandHandlers.get('user')
      expect(handler).toBeDefined()
      const { reply, getReplies } = createMockReply()
      await handler!(createDmMessage(ADMIN_ID, 'add 123456'), reply, {
        allowed: true,
        isBotAdmin: true,
        isGroupAdmin: false,
        storageContextId: ADMIN_ID,
      })
      expect(getReplies()[0]).toContain('123456 authorized.')
      expect(isAuthorized('123456')).toBe(true)
    })

    test('adds user by @username and confirms', async () => {
      const handler = commandHandlers.get('user')
      expect(handler).toBeDefined()
      const { reply, getReplies } = createMockReply()
      await handler!(createDmMessage(ADMIN_ID, 'add @alice'), reply, {
        allowed: true,
        isBotAdmin: true,
        isGroupAdmin: false,
        storageContextId: ADMIN_ID,
      })
      expect(getReplies()[0]).toContain('@alice authorized.')
      const users = listUsers()
      expect(users.some((u) => u.username === 'alice')).toBe(true)
    })

    test('rejects non-admin caller', async () => {
      const handler = commandHandlers.get('user')
      expect(handler).toBeDefined()
      addUser('other-user', ADMIN_ID)
      const { reply, getReplies } = createMockReply()
      await handler!(createDmMessage('other-user', 'add 999'), reply, {
        allowed: true,
        isBotAdmin: false,
        isGroupAdmin: false,
        storageContextId: 'other-user',
      })
      expect(getReplies()[0]).toBe('Only the admin can manage users.')
      expect(isAuthorized('999')).toBe(false)
    })

    test('shows usage when identifier is missing', async () => {
      const handler = commandHandlers.get('user')
      expect(handler).toBeDefined()
      const { reply, getReplies } = createMockReply()
      await handler!(createDmMessage(ADMIN_ID, 'add'), reply, {
        allowed: true,
        isBotAdmin: true,
        isGroupAdmin: false,
        storageContextId: ADMIN_ID,
      })
      expect(getReplies()[0]).toContain('Usage: /user add')
    })
  })

  describe('/user remove', () => {
    test('removes user by ID and confirms', async () => {
      addUser('999', ADMIN_ID)
      const handler = commandHandlers.get('user')
      expect(handler).toBeDefined()
      const { reply, getReplies } = createMockReply()
      await handler!(createDmMessage(ADMIN_ID, 'remove 999'), reply, {
        allowed: true,
        isBotAdmin: true,
        isGroupAdmin: false,
        storageContextId: ADMIN_ID,
      })
      expect(getReplies()[0]).toContain('removed')
      expect(isAuthorized('999')).toBe(false)
    })

    test('removes user by @username and confirms', async () => {
      addUser('placeholder-bob', ADMIN_ID, 'bob')
      const handler = commandHandlers.get('user')
      expect(handler).toBeDefined()
      const { reply, getReplies } = createMockReply()
      await handler!(createDmMessage(ADMIN_ID, 'remove @bob'), reply, {
        allowed: true,
        isBotAdmin: true,
        isGroupAdmin: false,
        storageContextId: ADMIN_ID,
      })
      expect(getReplies()[0]).toContain('removed')
      expect(listUsers().some((u) => u.username === 'bob')).toBe(false)
    })

    test('blocks admin from removing themselves', async () => {
      const handler = commandHandlers.get('user')
      expect(handler).toBeDefined()
      const { reply, getReplies } = createMockReply()
      await handler!(createDmMessage(ADMIN_ID, `remove ${ADMIN_ID}`), reply, {
        allowed: true,
        isBotAdmin: true,
        isGroupAdmin: false,
        storageContextId: ADMIN_ID,
      })
      expect(getReplies()[0]).toBe('Cannot remove the admin user.')
      expect(isAuthorized(ADMIN_ID)).toBe(true)
    })

    test('rejects non-admin caller', async () => {
      addUser('other-user', ADMIN_ID)
      addUser('victim', ADMIN_ID)
      const handler = commandHandlers.get('user')
      expect(handler).toBeDefined()
      const { reply, getReplies } = createMockReply()
      await handler!(createDmMessage('other-user', 'remove victim'), reply, {
        allowed: true,
        isBotAdmin: false,
        isGroupAdmin: false,
        storageContextId: 'other-user',
      })
      expect(getReplies()[0]).toBe('Only the admin can manage users.')
      expect(isAuthorized('victim')).toBe(true)
    })
  })

  describe('/users', () => {
    test('lists all authorized users', async () => {
      addUser('user-a', ADMIN_ID)
      addUser('user-b', ADMIN_ID)
      const handler = commandHandlers.get('users')
      expect(handler).toBeDefined()
      const { reply, getReplies } = createMockReply()
      await handler!(createDmMessage(ADMIN_ID, ''), reply, {
        allowed: true,
        isBotAdmin: true,
        isGroupAdmin: false,
        storageContextId: ADMIN_ID,
      })
      expect(getReplies()[0]).toContain('user-a')
      expect(getReplies()[0]).toContain('user-b')
    })

    test('shows empty message when no users except admin', async () => {
      // Delete all users to simulate empty state
      getTestDb().delete(schema.users).run()
      const handler = commandHandlers.get('users')
      expect(handler).toBeDefined()
      const { reply, getReplies } = createMockReply()
      await handler!(createDmMessage(ADMIN_ID, ''), reply, {
        allowed: true,
        isBotAdmin: true,
        isGroupAdmin: false,
        storageContextId: ADMIN_ID,
      })
      expect(getReplies()[0]).toBe('No authorized users.')
    })

    test('rejects non-admin caller', async () => {
      addUser('other-user', ADMIN_ID)
      const handler = commandHandlers.get('users')
      expect(handler).toBeDefined()
      const { reply, getReplies } = createMockReply()
      await handler!(createDmMessage('other-user', ''), reply, {
        allowed: true,
        isBotAdmin: false,
        isGroupAdmin: false,
        storageContextId: 'other-user',
      })
      expect(getReplies()[0]).toBe('Only the admin can list users.')
    })
  })
})
