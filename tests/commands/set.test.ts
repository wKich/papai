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

import { registerSetCommand } from '../../src/commands/set.js'
import { getConfig } from '../../src/config.js'
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

const USER_ID = 'set-test-user'

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

function createAuth(userId: string, allowed: boolean): AuthorizationResult {
  return {
    allowed,
    isBotAdmin: allowed,
    isGroupAdmin: false,
    storageContextId: userId,
  }
}

describe('/set Command', () => {
  let setHandler: CommandHandler | null

  beforeEach(() => {
    testSqlite = new Database(':memory:')
    testDb = drizzle(testSqlite, { schema })
    runMigrations(testSqlite, MIGRATIONS)
    clearUserCache(USER_ID)

    setHandler = null
    const mockChat: ChatProvider = {
      name: 'mock',
      registerCommand: (_name: string, handler: CommandHandler): void => {
        setHandler = handler
      },
      onMessage: (): void => {},
      sendMessage: (): Promise<void> => Promise.resolve(),
      start: (): Promise<void> => Promise.resolve(),
      stop: (): Promise<void> => Promise.resolve(),
    }
    registerSetCommand(mockChat, (_userId: string) => true)
  })

  test('stores valid config key and confirms', async () => {
    expect(setHandler).not.toBeNull()
    const { reply, textCalls } = createMockReply()
    await setHandler!(createDmMessage(USER_ID, 'llm_apikey sk-test1234'), reply, createAuth(USER_ID, true))
    expect(textCalls[0]).toBe('Set llm_apikey successfully.')
    expect(getConfig(USER_ID, 'llm_apikey')).toBe('sk-test1234')
  })

  test('stores main_model and confirms', async () => {
    expect(setHandler).not.toBeNull()
    const { reply, textCalls } = createMockReply()
    await setHandler!(createDmMessage(USER_ID, 'main_model gpt-4o'), reply, createAuth(USER_ID, true))
    expect(textCalls[0]).toBe('Set main_model successfully.')
    expect(getConfig(USER_ID, 'main_model')).toBe('gpt-4o')
  })

  test('stores llm_baseurl and confirms', async () => {
    expect(setHandler).not.toBeNull()
    const { reply, textCalls } = createMockReply()
    await setHandler!(
      createDmMessage(USER_ID, 'llm_baseurl https://api.openai.com/v1'),
      reply,
      createAuth(USER_ID, true),
    )
    expect(textCalls[0]).toBe('Set llm_baseurl successfully.')
    expect(getConfig(USER_ID, 'llm_baseurl')).toBe('https://api.openai.com/v1')
  })

  test('rejects unknown key', async () => {
    expect(setHandler).not.toBeNull()
    const { reply, textCalls } = createMockReply()
    await setHandler!(createDmMessage(USER_ID, 'invalid_key value'), reply, createAuth(USER_ID, true))
    expect(textCalls[0]).toContain('Unknown key')
    expect(getConfig(USER_ID, 'llm_apikey')).toBeNull()
  })

  test('shows usage when value is missing', async () => {
    expect(setHandler).not.toBeNull()
    const { reply, textCalls } = createMockReply()
    await setHandler!(createDmMessage(USER_ID, 'llm_apikey'), reply, createAuth(USER_ID, true))
    expect(textCalls[0]).toContain('Usage: /set')
  })

  test('rejects unauthorized user silently', async () => {
    expect(setHandler).not.toBeNull()
    const { reply, textCalls } = createMockReply()
    await setHandler!(
      createDmMessage('unauthorized-user', 'main_model gpt-4'),
      reply,
      createAuth('unauthorized-user', false),
    )
    expect(textCalls).toHaveLength(0)
    expect(getConfig('unauthorized-user', 'main_model')).toBeNull()
  })
})
