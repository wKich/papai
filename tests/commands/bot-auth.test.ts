import { Database } from 'bun:sqlite'
import { beforeEach, describe, expect, mock, test } from 'bun:test'

import { drizzle } from 'drizzle-orm/bun-sqlite'

import type { ChatProvider, IncomingMessage, ReplyFn } from '../../src/chat/types.js'
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

// Track processMessage calls
let processMessageCallCount = 0
let lastProcessedStorageId: string | null = null

// Mock processMessage to avoid LLM/config dependencies
void mock.module('../../src/llm-orchestrator.js', () => ({
  processMessage: (_reply: unknown, storageContextId: string): Promise<void> => {
    processMessageCallCount++
    lastProcessedStorageId = storageContextId
    return Promise.resolve()
  },
}))

// Mock all other commands to avoid their side effects
void mock.module('../../src/commands/index.js', () => ({
  registerHelpCommand: (): void => {},
  registerSetCommand: (): void => {},
  registerConfigCommand: (): void => {},
  registerContextCommand: (): void => {},
  registerClearCommand: (): void => {},
  registerAdminCommands: (): void => {},
  registerGroupCommand: (): void => {},
}))

import { setupBot } from '../../src/bot.js'
import { runMigrations } from '../../src/db/migrate.js'
import { migration001Initial } from '../../src/db/migrations/001_initial.js'
import { migration002ConversationHistory } from '../../src/db/migrations/002_conversation_history.js'
import { migration003MultiuserSupport } from '../../src/db/migrations/003_multiuser_support.js'
import { migration004KaneoWorkspace } from '../../src/db/migrations/004_kaneo_workspace.js'
import { migration005RenameConfigKeys } from '../../src/db/migrations/005_rename_config_keys.js'
import { migration006VersionAnnouncements } from '../../src/db/migrations/006_version_announcements.js'
import { migration007PlatformUserId } from '../../src/db/migrations/007_platform_user_id.js'
import { migration008GroupMembers } from '../../src/db/migrations/008_group_members.js'
import { addUser, isAuthorized, removeUser } from '../../src/users.js'

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

const ADMIN_ID = 'admin-bot-auth'

function createDmMessage(userId: string, username: string | null = null): IncomingMessage {
  return {
    user: { id: userId, username, isAdmin: false },
    contextId: userId,
    contextType: 'dm',
    isMentioned: false,
    text: 'hello',
    commandMatch: undefined,
  }
}

function createMockReply(): { reply: ReplyFn; textCalls: string[] } {
  const textCalls: string[] = []
  const reply: ReplyFn = {
    text: (content: string): Promise<void> => {
      textCalls.push(content)
      return Promise.resolve()
    },
    formatted: (): Promise<void> => Promise.resolve(),
    file: (): Promise<void> => Promise.resolve(),
    typing: (): void => {},
  }
  return { reply, textCalls }
}

describe('Bot Authorization Gate', () => {
  let messageHandler: ((msg: IncomingMessage, reply: ReplyFn) => Promise<void>) | null

  beforeEach(() => {
    testSqlite = new Database(':memory:')
    testDb = drizzle(testSqlite, { schema })
    runMigrations(testSqlite, MIGRATIONS)

    // Reset call tracking
    processMessageCallCount = 0
    lastProcessedStorageId = null
    messageHandler = null

    const mockChat: ChatProvider = {
      name: 'mock',
      registerCommand: (): void => {},
      onMessage: (handler): void => {
        messageHandler = handler
      },
      sendMessage: (): Promise<void> => Promise.resolve(),
      start: (): Promise<void> => Promise.resolve(),
      stop: (): Promise<void> => Promise.resolve(),
    }

    setupBot(mockChat, ADMIN_ID)
  })

  describe('Unauthorized user — silent drop', () => {
    test('does not call processMessage for unauthorized user', async () => {
      expect(messageHandler).not.toBeNull()
      const { reply } = createMockReply()
      await messageHandler!(createDmMessage('unknown-user'), reply)
      expect(processMessageCallCount).toBe(0)
    })

    test('does not call reply.text for unauthorized user', async () => {
      expect(messageHandler).not.toBeNull()
      const { reply, textCalls } = createMockReply()
      await messageHandler!(createDmMessage('unknown-user'), reply)
      expect(textCalls).toHaveLength(0)
    })
  })

  describe('Authorized user — message processed', () => {
    test('calls processMessage for authorized user', async () => {
      addUser('auth-user', ADMIN_ID)
      expect(messageHandler).not.toBeNull()
      const { reply } = createMockReply()
      await messageHandler!(createDmMessage('auth-user'), reply)
      expect(processMessageCallCount).toBe(1)
      expect(lastProcessedStorageId).toBe('auth-user')
    })
  })

  describe('Username resolution on first message', () => {
    test('resolves username to real ID on first message', async () => {
      // Add user by username (placeholder ID, like /user add @newuser)
      addUser('placeholder-uuid', ADMIN_ID, 'newuser')
      expect(messageHandler).not.toBeNull()
      const { reply } = createMockReply()
      // First message from real user ID with that username
      await messageHandler!(createDmMessage('real-555', 'newuser'), reply)
      expect(processMessageCallCount).toBe(1)
      expect(isAuthorized('real-555')).toBe(true)
    })

    test('subsequent messages from resolved user pass authorization', async () => {
      addUser('placeholder-uuid-2', ADMIN_ID, 'resolveduser')
      expect(messageHandler).not.toBeNull()
      const { reply: reply1 } = createMockReply()
      // First message - resolves username
      await messageHandler!(createDmMessage('real-666', 'resolveduser'), reply1)
      expect(processMessageCallCount).toBe(1)

      // Second message - should use real ID directly
      const { reply: reply2 } = createMockReply()
      await messageHandler!(createDmMessage('real-666', 'resolveduser'), reply2)
      expect(processMessageCallCount).toBe(2)
    })
  })

  describe('Access revoked during session', () => {
    test('drops message after user is removed', async () => {
      addUser('removable-user', ADMIN_ID)
      expect(messageHandler).not.toBeNull()

      // First message — authorized
      const { reply: reply1 } = createMockReply()
      await messageHandler!(createDmMessage('removable-user'), reply1)
      expect(processMessageCallCount).toBe(1)

      // Remove user
      removeUser('removable-user')

      // Second message — should be dropped
      const { reply: reply2, textCalls } = createMockReply()
      await messageHandler!(createDmMessage('removable-user'), reply2)
      expect(processMessageCallCount).toBe(1)
      expect(textCalls).toHaveLength(0)
    })
  })
})
