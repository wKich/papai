import { Database } from 'bun:sqlite'
import { beforeEach, describe, expect, mock, test } from 'bun:test'

import { drizzle } from 'drizzle-orm/bun-sqlite'

import type { ChatProvider, CommandHandler, IncomingMessage, ReplyFn } from '../../src/chat/types.js'
import * as schema from '../../src/db/schema.js'

// --- Test database setup ---
let testDb: ReturnType<typeof drizzle<typeof schema>>
let testSqlite: Database

// Mock getDrizzleDb BEFORE importing source modules
void mock.module('../../src/db/drizzle.js', () => ({
  getDrizzleDb: (): ReturnType<typeof drizzle<typeof schema>> => testDb,
}))

// Mock logger to avoid output during tests
void mock.module('../../src/logger.js', () => ({
  logger: {
    child: (): { debug: () => void; info: () => void; warn: () => void; error: () => void } => ({
      debug: (): void => {},
      info: (): void => {},
      warn: (): void => {},
      error: (): void => {},
    }),
  },
}))

// Mock provisionAndConfigure to bypass Kaneo HTTP calls
void mock.module('../../src/providers/kaneo/provision.js', () => ({
  provisionAndConfigure: (): Promise<{ status: string }> => Promise.resolve({ status: 'skipped' }),
}))

import { registerAdminCommands } from '../../src/commands/admin.js'
import { runMigrations } from '../../src/db/migrate.js'
import { migration001Initial } from '../../src/db/migrations/001_initial.js'
import { migration002ConversationHistory } from '../../src/db/migrations/002_conversation_history.js'
import { migration003MultiuserSupport } from '../../src/db/migrations/003_multiuser_support.js'
import { migration004KaneoWorkspace } from '../../src/db/migrations/004_kaneo_workspace.js'
import { migration005RenameConfigKeys } from '../../src/db/migrations/005_rename_config_keys.js'
import { migration006VersionAnnouncements } from '../../src/db/migrations/006_version_announcements.js'
import { migration007PlatformUserId } from '../../src/db/migrations/007_platform_user_id.js'
import { migration008GroupMembers } from '../../src/db/migrations/008_group_members.js'
import { addUser, isAuthorized, listUsers } from '../../src/users.js'

const MIGRATIONS = [
  migration001Initial,
  migration002ConversationHistory,
  migration003MultiuserSupport,
  migration004KaneoWorkspace,
  migration005RenameConfigKeys,
  migration006VersionAnnouncements,
  migration007PlatformUserId,
  migration008GroupMembers,
] as const

const ADMIN_ID = 'admin-001'

function createMockReply(): { reply: ReplyFn; getReplies: () => string[] } {
  const replies: string[] = []
  const reply: ReplyFn = {
    text: (content: string): Promise<void> => {
      replies.push(content)
      return Promise.resolve()
    },
    formatted: (): Promise<void> => Promise.resolve(),
    file: (): Promise<void> => Promise.resolve(),
    typing: (): void => {},
  }
  return { reply, getReplies: () => replies }
}

function createDmMessage(userId: string, commandMatch: string): IncomingMessage {
  return {
    user: { id: userId, username: null, isAdmin: false },
    contextId: userId,
    contextType: 'dm',
    isMentioned: false,
    text: '',
    commandMatch,
  }
}

describe('Admin Commands', () => {
  let commandHandlers: Map<string, CommandHandler>

  beforeEach(() => {
    testSqlite = new Database(':memory:')
    testDb = drizzle(testSqlite, { schema })
    runMigrations(testSqlite, MIGRATIONS)

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
      testDb.delete(schema.users).run()
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
