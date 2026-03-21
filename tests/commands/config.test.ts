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

import { registerConfigCommand } from '../../src/commands/config.js'
import { setConfig } from '../../src/config.js'
import { runMigrations } from '../../src/db/migrate.js'
import { migration001Initial } from '../../src/db/migrations/001_initial.js'
import { migration002ConversationHistory } from '../../src/db/migrations/002_conversation_history.js'
import { migration003MultiuserSupport } from '../../src/db/migrations/003_multiuser_support.js'
import { migration004KaneoWorkspace } from '../../src/db/migrations/004_kaneo_workspace.js'
import { migration005RenameConfigKeys } from '../../src/db/migrations/005_rename_config_keys.js'
import { migration006VersionAnnouncements } from '../../src/db/migrations/006_version_announcements.js'
import { migration007PlatformUserId } from '../../src/db/migrations/007_platform_user_id.js'
import { migration008GroupMembers } from '../../src/db/migrations/008_group_members.js'
import { clearUserCache } from '../utils/test-cache.js'

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

const USER_ID = 'config-test-user'

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

function createDmMessage(userId: string): IncomingMessage {
  return {
    user: { id: userId, username: null, isAdmin: false },
    contextId: userId,
    contextType: 'dm',
    isMentioned: false,
    text: '',
    commandMatch: '',
  }
}

function createAuth(userId: string, allowed: boolean): AuthorizationResult {
  return {
    allowed,
    isBotAdmin: allowed,
    isGroupAdmin: false,
    storageContextId: userId,
  }
}

describe('/config Command', () => {
  let configHandler: CommandHandler | null

  beforeEach(() => {
    testSqlite = new Database(':memory:')
    testDb = drizzle(testSqlite, { schema })
    runMigrations(testSqlite, MIGRATIONS)
    clearUserCache(USER_ID)

    configHandler = null
    const mockChat: ChatProvider = {
      name: 'mock',
      registerCommand: (_name: string, handler: CommandHandler): void => {
        configHandler = handler
      },
      onMessage: (): void => {},
      sendMessage: (): Promise<void> => Promise.resolve(),
      start: (): Promise<void> => Promise.resolve(),
      stop: (): Promise<void> => Promise.resolve(),
    }
    registerConfigCommand(mockChat, (_userId: string) => true)
  })

  test('shows all config keys with values and masked secrets', async () => {
    setConfig(USER_ID, 'llm_apikey', 'sk-abc1234')
    expect(configHandler).not.toBeNull()
    const { reply, textCalls } = createMockReply()
    await configHandler!(createDmMessage(USER_ID), reply, createAuth(USER_ID, true))
    expect(textCalls[0]).toContain('llm_apikey: ****1234')
    expect(textCalls[0]).toContain('main_model: (not set)')
  })

  test('shows unset placeholder for unconfigured keys', async () => {
    expect(configHandler).not.toBeNull()
    const { reply, textCalls } = createMockReply()
    await configHandler!(createDmMessage(USER_ID), reply, createAuth(USER_ID, true))
    const output = textCalls[0] ?? ''
    expect(output.length).toBeGreaterThan(0)
    const lines = output.split('\n').filter((line) => line.trim().length > 0)
    expect(lines.length).toBeGreaterThan(0)
    // Every non-empty line should show "(not set)" since no keys are configured
    expect(lines.every((line) => line.includes('(not set)'))).toBe(true)
  })

  test('rejects unauthorized user silently', async () => {
    expect(configHandler).not.toBeNull()
    const { reply, textCalls } = createMockReply()
    await configHandler!(createDmMessage('unauthorized-user'), reply, createAuth('unauthorized-user', false))
    expect(textCalls).toHaveLength(0)
  })
})
