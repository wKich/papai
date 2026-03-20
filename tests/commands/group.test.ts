import { Database } from 'bun:sqlite'
import { beforeEach, describe, expect, mock, test } from 'bun:test'

import { drizzle } from 'drizzle-orm/bun-sqlite'

import type {
  AuthorizationResult,
  ChatProvider,
  CommandHandler,
  IncomingMessage,
  ReplyFn,
} from '../../src/chat/types.js'
import * as schema from '../../src/db/schema.js'

// --- Test database setup with Drizzle ---
let testDb: ReturnType<typeof drizzle<typeof schema>>
let testSqlite: Database

// Mock getDrizzleDb to return our test database
void mock.module('../../src/db/drizzle.js', () => ({
  getDrizzleDb: (): ReturnType<typeof drizzle<typeof schema>> => testDb,
}))

// Mock logger to avoid output during tests
void mock.module('../../src/logger.js', () => ({
  logger: {
    child: (): object => ({
      debug: (): void => {},
      info: (): void => {},
      warn: (): void => {},
      error: (): void => {},
    }),
  },
}))

import { registerGroupCommand } from '../../src/commands/group.js'

describe('group commands', () => {
  let mockChat: ChatProvider
  let commandHandlers: Map<string, CommandHandler>
  let lastReply: string | null

  const createMockReply = (): ReplyFn => ({
    text: async (content: string): Promise<void> => {
      lastReply = content
    },
    formatted: async (): Promise<void> => {},
    file: async (): Promise<void> => {},
    typing: (): void => {},
  })

  const createMockAuth = (isGroupAdmin: boolean): AuthorizationResult => ({
    allowed: true,
    isBotAdmin: false,
    isGroupAdmin,
    storageContextId: 'group1',
  })

  const createGroupMessage = (userId: string, commandMatch?: string, isAdmin = false): IncomingMessage => ({
    user: {
      id: userId,
      username: 'testuser',
      isAdmin,
    },
    contextId: 'group1',
    contextType: 'group',
    isMentioned: false,
    text: commandMatch !== undefined && commandMatch !== '' ? `/group ${commandMatch}` : '/group',
    commandMatch,
  })

  beforeEach(() => {
    // Setup test database
    testSqlite = new Database(':memory:')
    testDb = drizzle(testSqlite, { schema })
    // Create group_members table
    testSqlite.run(`
      CREATE TABLE group_members (
        group_id TEXT NOT NULL,
        user_id TEXT NOT NULL,
        added_by TEXT NOT NULL,
        added_at TEXT NOT NULL DEFAULT (datetime('now')),
        PRIMARY KEY (group_id, user_id)
      )
    `)

    // Setup mock chat provider
    commandHandlers = new Map()
    mockChat = {
      name: 'mock',
      registerCommand: (name: string, handler: CommandHandler): void => {
        commandHandlers.set(name, handler)
      },
      onMessage: (): void => {},
      sendMessage: async (): Promise<void> => {},
      start: async (): Promise<void> => {},
      stop: async (): Promise<void> => {},
    }

    // Register the group command
    registerGroupCommand(mockChat)

    lastReply = null
  })

  describe('adduser', () => {
    test('adds user when admin', async () => {
      const handler = commandHandlers.get('group')
      expect(handler).toBeDefined()

      await handler!(createGroupMessage('admin1', 'adduser @user1', true), createMockReply(), createMockAuth(true))

      expect(lastReply).toBe('User @user1 added to this group.')
    })

    test('rejects non-admins', async () => {
      const handler = commandHandlers.get('group')

      await handler!(createGroupMessage('user1', 'adduser @user2', false), createMockReply(), createMockAuth(false))

      expect(lastReply).toBe('Only group admins can add users.')
    })

    test('requires username argument', async () => {
      const handler = commandHandlers.get('group')

      await handler!(createGroupMessage('admin1', 'adduser', true), createMockReply(), createMockAuth(true))

      expect(lastReply).toBe('Usage: /group adduser <@username>')
    })

    test('rejects invalid user format', async () => {
      const handler = commandHandlers.get('group')

      await handler!(
        createGroupMessage('admin1', 'adduser invalid@user', true),
        createMockReply(),
        createMockAuth(true),
      )

      expect(lastReply).toBe('Please provide a valid user mention or ID.')
    })

    test('accepts numeric user ID', async () => {
      const handler = commandHandlers.get('group')

      await handler!(createGroupMessage('admin1', 'adduser 12345', true), createMockReply(), createMockAuth(true))

      expect(lastReply).toBe('User 12345 added to this group.')
    })
  })

  describe('deluser', () => {
    test('removes user when admin', async () => {
      // First add a user
      const { addGroupMember } = await import('../../src/groups.js')
      addGroupMember('group1', 'user1', 'admin1')

      const handler = commandHandlers.get('group')

      await handler!(createGroupMessage('admin1', 'deluser user1', true), createMockReply(), createMockAuth(true))

      expect(lastReply).toBe('User user1 removed from this group.')
    })

    test('rejects non-admins', async () => {
      const handler = commandHandlers.get('group')

      await handler!(createGroupMessage('user1', 'deluser user2', false), createMockReply(), createMockAuth(false))

      expect(lastReply).toBe('Only group admins can remove users.')
    })

    test('requires username argument', async () => {
      const handler = commandHandlers.get('group')

      await handler!(createGroupMessage('admin1', 'deluser', true), createMockReply(), createMockAuth(true))

      expect(lastReply).toBe('Usage: /group deluser <@username>')
    })

    test('rejects invalid user format', async () => {
      const handler = commandHandlers.get('group')

      await handler!(
        createGroupMessage('admin1', 'deluser invalid@user', true),
        createMockReply(),
        createMockAuth(true),
      )

      expect(lastReply).toBe('Please provide a valid user mention or ID.')
    })

    test('handles non-existent user gracefully', async () => {
      const handler = commandHandlers.get('group')

      await handler!(createGroupMessage('admin1', 'deluser nonexistent', true), createMockReply(), createMockAuth(true))

      expect(lastReply).toBe('User nonexistent removed from this group.')
    })
  })

  describe('users', () => {
    test('lists empty group', async () => {
      const handler = commandHandlers.get('group')

      await handler!(createGroupMessage('user1', 'users', false), createMockReply(), createMockAuth(false))

      expect(lastReply).toBe('No members in this group yet.')
    })

    test('lists group members', async () => {
      // Add some users
      const { addGroupMember } = await import('../../src/groups.js')
      addGroupMember('group1', 'user1', 'admin1')
      addGroupMember('group1', 'user2', 'admin1')

      const handler = commandHandlers.get('group')

      await handler!(createGroupMessage('user1', 'users', false), createMockReply(), createMockAuth(false))

      expect(lastReply).toContain('Group members:')
      expect(lastReply).toContain('user1')
      expect(lastReply).toContain('user2')
      expect(lastReply).toContain('added by admin1')
    })

    test('accessible to any member (not just admins)', async () => {
      const { addGroupMember } = await import('../../src/groups.js')
      addGroupMember('group1', 'user1', 'admin1')

      const handler = commandHandlers.get('group')

      await handler!(createGroupMessage('user1', 'users', false), createMockReply(), createMockAuth(false))

      expect(lastReply).toContain('Group members:')
    })
  })

  describe('context validation', () => {
    test('rejects in DM context', async () => {
      const handler = commandHandlers.get('group')

      const dmMessage: IncomingMessage = {
        user: {
          id: 'user1',
          username: 'testuser',
          isAdmin: true,
        },
        contextId: 'user1',
        contextType: 'dm',
        isMentioned: false,
        text: '/group users',
        commandMatch: 'users',
      }

      await handler!(dmMessage, createMockReply(), createMockAuth(true))

      expect(lastReply).toBe('Group commands can only be used in group chats.')
    })
  })

  describe('unknown subcommand', () => {
    test('shows usage for unknown subcommand', async () => {
      const handler = commandHandlers.get('group')

      await handler!(createGroupMessage('user1', 'unknown', false), createMockReply(), createMockAuth(false))

      expect(lastReply).toContain('Unknown subcommand')
      expect(lastReply).toContain('Usage: /group adduser')
    })

    test('shows usage when no subcommand', async () => {
      const handler = commandHandlers.get('group')

      const message = createGroupMessage('user1', '', false)
      message.commandMatch = ''

      await handler!(message, createMockReply(), createMockAuth(false))

      expect(lastReply).toContain('Usage: /group adduser')
    })
  })
})
