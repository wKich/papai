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

import { registerAdminCommands } from '../../src/commands/admin.js'
import { registerClearCommand } from '../../src/commands/clear.js'
import { registerConfigCommand } from '../../src/commands/config.js'
import { registerSetCommand } from '../../src/commands/set.js'
import { addUser } from '../../src/users.js'

describe('command context restrictions', () => {
  let mockChat: ChatProvider
  let commandHandlers: Map<string, CommandHandler>
  let lastReply: string | null
  const adminUserId = 'admin123'

  const createMockReply = (): ReplyFn => ({
    text: async (content: string): Promise<void> => {
      lastReply = content
    },
    formatted: async (): Promise<void> => {},
    file: async (): Promise<void> => {},
    typing: (): void => {},
  })

  const createMockAuth = (opts: {
    allowed?: boolean
    isBotAdmin?: boolean
    isGroupAdmin?: boolean
  }): AuthorizationResult => ({
    allowed: opts.allowed ?? true,
    isBotAdmin: opts.isBotAdmin ?? false,
    isGroupAdmin: opts.isGroupAdmin ?? false,
    storageContextId: 'group1',
  })

  const createGroupMessage = (userId: string, isPlatformAdmin = false): IncomingMessage => ({
    user: {
      id: userId,
      username: 'testuser',
      isAdmin: isPlatformAdmin,
    },
    contextId: 'group1',
    contextType: 'group',
    isMentioned: false,
    text: '',
    commandMatch: '',
  })

  const createDmMessage = (userId: string): IncomingMessage => ({
    user: {
      id: userId,
      username: 'testuser',
      isAdmin: false,
    },
    contextId: userId,
    contextType: 'dm',
    isMentioned: false,
    text: '',
    commandMatch: '',
  })

  const checkAuthorization = (userId: string): boolean => {
    return userId === adminUserId
  }

  beforeEach(() => {
    // Setup test database
    testSqlite = new Database(':memory:')
    testDb = drizzle(testSqlite, { schema })

    // Create required tables matching Drizzle schema
    testSqlite.run(`
      CREATE TABLE users (
        platform_user_id TEXT PRIMARY KEY,
        username TEXT UNIQUE,
        added_at TEXT NOT NULL DEFAULT (datetime('now')),
        added_by TEXT NOT NULL,
        kaneo_workspace_id TEXT
      )
    `)
    testSqlite.run(`
      CREATE TABLE user_config (
        user_id TEXT NOT NULL,
        key TEXT NOT NULL,
        value TEXT NOT NULL,
        PRIMARY KEY (user_id, key)
      )
    `)
    testSqlite.run(`
      CREATE TABLE conversation_history (
        user_id TEXT PRIMARY KEY,
        messages TEXT NOT NULL
      )
    `)
    testSqlite.run(`
      CREATE TABLE memory_summary (
        user_id TEXT PRIMARY KEY,
        summary TEXT NOT NULL,
        updated_at TEXT NOT NULL
      )
    `)
    testSqlite.run(`
      CREATE TABLE memory_facts (
        user_id TEXT NOT NULL,
        identifier TEXT NOT NULL,
        title TEXT NOT NULL,
        url TEXT NOT NULL DEFAULT '',
        last_seen TEXT NOT NULL,
        PRIMARY KEY (user_id, identifier)
      )
    `)

    // Add admin user
    addUser(adminUserId, adminUserId)

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

    // Register commands
    registerSetCommand(mockChat, checkAuthorization)
    registerClearCommand(mockChat, checkAuthorization, adminUserId)
    registerConfigCommand(mockChat, checkAuthorization)
    registerAdminCommands(mockChat, adminUserId)

    lastReply = null
  })

  describe('/set command', () => {
    test('rejected for non-admin in group', async () => {
      const handler = commandHandlers.get('set')
      expect(handler).toBeDefined()

      const msg = createGroupMessage('user456', false)
      const auth = createMockAuth({ allowed: true, isBotAdmin: false, isGroupAdmin: false })

      await handler!(msg, createMockReply(), auth)

      expect(lastReply).toBe('Only group admins can run this command.')
    })

    test('allowed for group admin in group', async () => {
      const handler = commandHandlers.get('set')

      const msg = createGroupMessage('user456', true)
      msg.commandMatch = 'provider kaneo'
      const auth = createMockAuth({ allowed: true, isBotAdmin: false, isGroupAdmin: true })

      await handler!(msg, createMockReply(), auth)

      expect(lastReply).toBe('Set provider successfully.')
    })

    test('allowed for bot admin in group', async () => {
      const handler = commandHandlers.get('set')

      const msg = createGroupMessage(adminUserId, false)
      msg.commandMatch = 'provider kaneo'
      const auth = createMockAuth({ allowed: true, isBotAdmin: true, isGroupAdmin: false })

      await handler!(msg, createMockReply(), auth)

      expect(lastReply).toBe('Set provider successfully.')
    })

    test('allowed for regular user in DM', async () => {
      const handler = commandHandlers.get('set')

      const msg = createDmMessage('user456')
      msg.commandMatch = 'provider kaneo'
      // Make user authorized
      addUser('user456', adminUserId)
      const auth = createMockAuth({ allowed: true, isBotAdmin: false, isGroupAdmin: false })
      auth.storageContextId = 'user456'

      await handler!(msg, createMockReply(), auth)

      expect(lastReply).toBe('Set provider successfully.')
    })
  })

  describe('/clear command', () => {
    test('rejected for non-admin in group', async () => {
      const handler = commandHandlers.get('clear')
      expect(handler).toBeDefined()

      const msg = createGroupMessage('user456', false)
      const auth = createMockAuth({ allowed: true, isBotAdmin: false, isGroupAdmin: false })

      await handler!(msg, createMockReply(), auth)

      expect(lastReply).toBe('Only group admins can run this command.')
    })

    test('allowed for group admin in group', async () => {
      const handler = commandHandlers.get('clear')

      const msg = createGroupMessage('user456', true)
      const auth = createMockAuth({ allowed: true, isBotAdmin: false, isGroupAdmin: true })

      await handler!(msg, createMockReply(), auth)

      expect(lastReply).toBe('Conversation history and memory cleared.')
    })

    test('allowed for regular user in DM', async () => {
      const handler = commandHandlers.get('clear')

      const msg = createDmMessage('user456')
      // Make user authorized
      addUser('user456', adminUserId)
      const auth = createMockAuth({ allowed: true, isBotAdmin: false, isGroupAdmin: false })
      auth.storageContextId = 'user456'

      await handler!(msg, createMockReply(), auth)

      expect(lastReply).toBe('Conversation history and memory cleared.')
    })
  })

  describe('/config command', () => {
    test('rejected for non-admin in group', async () => {
      const handler = commandHandlers.get('config')
      expect(handler).toBeDefined()

      const msg = createGroupMessage('user456', false)
      const auth = createMockAuth({ allowed: true, isBotAdmin: false, isGroupAdmin: false })

      await handler!(msg, createMockReply(), auth)

      expect(lastReply).toBe('Only group admins can run this command.')
    })

    test('allowed for group admin in group', async () => {
      const handler = commandHandlers.get('config')

      const msg = createGroupMessage('user456', true)
      const auth = createMockAuth({ allowed: true, isBotAdmin: false, isGroupAdmin: true })

      await handler!(msg, createMockReply(), auth)

      expect(lastReply).toContain('provider:')
    })

    test('allowed for regular user in DM', async () => {
      const handler = commandHandlers.get('config')

      const msg = createDmMessage('user456')
      // Make user authorized
      addUser('user456', adminUserId)
      const auth = createMockAuth({ allowed: true, isBotAdmin: false, isGroupAdmin: false })
      auth.storageContextId = 'user456'

      await handler!(msg, createMockReply(), auth)

      expect(lastReply).toContain('provider:')
    })
  })

  describe('/user command', () => {
    test('rejected in group', async () => {
      const handler = commandHandlers.get('user')
      expect(handler).toBeDefined()

      const msg = createGroupMessage(adminUserId, true)
      msg.commandMatch = 'add user789'

      await handler!(msg, createMockReply(), createMockAuth({ allowed: true, isBotAdmin: true, isGroupAdmin: true }))

      expect(lastReply).toBe('This command is only available in direct messages.')
    })

    test('allowed in DM for admin', async () => {
      const handler = commandHandlers.get('user')

      const msg = createDmMessage(adminUserId)
      msg.commandMatch = 'add user789'

      await handler!(msg, createMockReply(), createMockAuth({ allowed: true, isBotAdmin: true, isGroupAdmin: false }))

      expect(lastReply).toBe('User @user789 authorized.')
    })
  })

  describe('/users command', () => {
    test('rejected in group', async () => {
      const handler = commandHandlers.get('users')
      expect(handler).toBeDefined()

      const msg = createGroupMessage(adminUserId, true)

      await handler!(msg, createMockReply(), createMockAuth({ allowed: true, isBotAdmin: true, isGroupAdmin: true }))

      expect(lastReply).toBe('This command is only available in direct messages.')
    })

    test('allowed in DM for admin', async () => {
      const handler = commandHandlers.get('users')

      const msg = createDmMessage(adminUserId)

      await handler!(msg, createMockReply(), createMockAuth({ allowed: true, isBotAdmin: true, isGroupAdmin: false }))

      expect(lastReply).toContain(adminUserId)
      expect(lastReply).toContain('(admin)')
    })
  })
})
