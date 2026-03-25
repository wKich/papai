import { Database } from 'bun:sqlite'
import { mock, type Mock } from 'bun:test'

import { drizzle } from 'drizzle-orm/bun-sqlite'

import type {
  AuthorizationResult,
  ChatProvider,
  CommandHandler,
  IncomingMessage,
  ReplyFn,
} from '../../src/chat/types.js'
import type { Migration } from '../../src/db/migrate.js'
import { migration001Initial } from '../../src/db/migrations/001_initial.js'
import { migration002ConversationHistory } from '../../src/db/migrations/002_conversation_history.js'
import { migration003MultiuserSupport } from '../../src/db/migrations/003_multiuser_support.js'
import { migration004KaneoWorkspace } from '../../src/db/migrations/004_kaneo_workspace.js'
import { migration005RenameConfigKeys } from '../../src/db/migrations/005_rename_config_keys.js'
import { migration006VersionAnnouncements } from '../../src/db/migrations/006_version_announcements.js'
import { migration007PlatformUserId } from '../../src/db/migrations/007_platform_user_id.js'
import { migration008GroupMembers } from '../../src/db/migrations/008_group_members.js'
import { migration009RecurringTasks } from '../../src/db/migrations/009_recurring_tasks.js'
import { migration010RecurringTaskOccurrences } from '../../src/db/migrations/010_recurring_task_occurrences.js'
import { migration011ProactiveAlerts } from '../../src/db/migrations/011_proactive_alerts.js'
import { migration012UserInstructions } from '../../src/db/migrations/012_user_instructions.js'
import { migration013DeferredPrompts } from '../../src/db/migrations/013_deferred_prompts.js'
import { migration014BackgroundEvents } from '../../src/db/migrations/014_background_events.js'
import { migration015DropBackgroundEvents } from '../../src/db/migrations/015_drop_background_events.js'
import { migration016ExecutionMetadata } from '../../src/db/migrations/016_execution_metadata.js'
import * as schema from '../../src/db/schema.js'
import type { AppError } from '../../src/errors.js'
import { getUserMessage } from '../../src/errors.js'
import { getLogLevel } from '../../src/logger.js'

// Static list of all migrations to avoid dynamic imports with type assertions
const ALL_MIGRATIONS: readonly Migration[] = [
  migration001Initial,
  migration002ConversationHistory,
  migration003MultiuserSupport,
  migration004KaneoWorkspace,
  migration005RenameConfigKeys,
  migration006VersionAnnouncements,
  migration007PlatformUserId,
  migration008GroupMembers,
  migration009RecurringTasks,
  migration010RecurringTaskOccurrences,
  migration011ProactiveAlerts,
  migration012UserInstructions,
  migration013DeferredPrompts,
  migration014BackgroundEvents,
  migration015DropBackgroundEvents,
  migration016ExecutionMetadata,
]

// ============================================================================
// DATABASE & MIGRATION HELPERS
// ============================================================================

let testDb: ReturnType<typeof drizzle<typeof schema>> | null = null
let testSqlite: Database | null = null

/**
 * Setup test database with all migrations.
 * Call this in beforeEach or at the start of each test.
 * Returns drizzle db instance.
 */
export async function setupTestDb(): Promise<ReturnType<typeof drizzle<typeof schema>>> {
  const { Database } = await import('bun:sqlite')
  const { drizzle } = await import('drizzle-orm/bun-sqlite')
  const { runMigrations } = await import('../../src/db/migrate.js')

  // Clear the in-memory user cache to prevent config/session bleed between tests
  const { _userCaches } = await import('../../src/cache.js')
  _userCaches.clear()

  testSqlite = new Database(':memory:')
  testDb = drizzle(testSqlite, { schema })

  runMigrations(testSqlite, [...ALL_MIGRATIONS])
  return testDb
}

/**
 * Get the current test database instance.
 * Throws if setupTestDb hasn't been called.
 */
export function getTestDb(): ReturnType<typeof drizzle<typeof schema>> {
  if (testDb === null) {
    throw new Error('Test database not initialized. Call setupTestDb() first.')
  }
  return testDb
}

/**
 * Mock the drizzle module to use test database.
 * Call this BEFORE importing any modules that use getDrizzleDb.
 */
export function mockDrizzle(): void {
  void mock.module('../../src/db/drizzle.js', () => ({
    getDrizzleDb: (): ReturnType<typeof drizzle<typeof schema>> => {
      if (testDb === null) {
        throw new Error('Test database not initialized. Call setupTestDb() first.')
      }
      return testDb
    },
  }))
}

// ============================================================================
// LOGGER MOCK
// ============================================================================

/**
 * Create a complete logger mock with all methods.
 * Use with: void mock.module('../../src/logger.js', () => ({ logger: createLoggerMock() }))
 */
export function createLoggerMock(): {
  debug: Mock<() => void>
  info: Mock<() => void>
  warn: Mock<() => void>
  error: Mock<() => void>
  child: Mock<() => { debug: () => void; info: () => void; warn: () => void; error: () => void }>
} {
  return {
    debug: mock(() => {}),
    info: mock(() => {}),
    warn: mock(() => {}),
    error: mock(() => {}),
    child: mock((): { debug: () => void; info: () => void; warn: () => void; error: () => void } => ({
      debug: (): void => {},
      info: (): void => {},
      warn: (): void => {},
      error: (): void => {},
    })),
  }
}

/**
 * Setup logger mock globally for tests.
 * Call this at the top of test files before importing modules that use logger.
 */
export function mockLogger(): void {
  void mock.module('../../src/logger.js', () => ({
    getLogLevel,
    logger: createLoggerMock(),
  }))
}

// ============================================================================
// REPLY MOCK FACTORIES
// ============================================================================

export interface MockReplyResult {
  reply: ReplyFn
  textCalls: string[]
  redactCalls: string[]
  getReplies: () => string[]
  getRedactions: () => string[]
}

/**
 * Create a mock reply function that captures text calls.
 */
export function createMockReply(): MockReplyResult {
  const textCalls: string[] = []
  const redactCalls: string[] = []
  const reply: ReplyFn = {
    text: (content: string): Promise<void> => {
      textCalls.push(content)
      return Promise.resolve()
    },
    formatted: (): Promise<void> => Promise.resolve(),
    file: (): Promise<void> => Promise.resolve(),
    typing: (): void => {},
    redactMessage: (replacementText: string): Promise<void> => {
      redactCalls.push(replacementText)
      return Promise.resolve()
    },
  }
  return { reply, textCalls, redactCalls, getReplies: () => textCalls, getRedactions: () => redactCalls }
}

/**
 * Create a mock reply with getter function (legacy compatibility).
 */
export function createMockReplyLegacy(): { reply: ReplyFn; getReplies: () => string[]; getRedactions: () => string[] } {
  const { reply, getReplies, getRedactions } = createMockReply()
  return { reply, getReplies, getRedactions }
}

// ============================================================================
// MESSAGE FACTORIES
// ============================================================================

/**
 * Create a DM message for testing commands.
 */
export function createDmMessage(
  userId: string,
  commandMatch: string = '',
  username: string | null = null,
): IncomingMessage {
  return {
    user: { id: userId, username, isAdmin: false },
    contextId: userId,
    contextType: 'dm',
    isMentioned: false,
    text: '',
    commandMatch,
  }
}

/**
 * Create a group message for testing commands.
 */
export function createGroupMessage(
  userId: string,
  text: string,
  isAdmin: boolean = false,
  groupId: string = 'group1',
): IncomingMessage {
  return {
    user: { id: userId, username: `user${userId}`, isAdmin },
    contextId: groupId,
    contextType: 'group',
    isMentioned: text.includes('@bot'),
    text,
    commandMatch: text.replace(/^\//, ''),
  }
}

// ============================================================================
// AUTHORIZATION HELPERS
// ============================================================================

/**
 * Create an authorization result for testing.
 */
export function createAuth(
  userId: string,
  options: {
    allowed?: boolean
    isBotAdmin?: boolean
    isGroupAdmin?: boolean
  } = {},
): AuthorizationResult {
  const { allowed = true, isBotAdmin = false, isGroupAdmin = false } = options
  return {
    allowed,
    isBotAdmin,
    isGroupAdmin,
    storageContextId: userId,
  }
}

// ============================================================================
// CHAT PROVIDER MOCK
// ============================================================================

/**
 * Create a mock chat provider that captures command registrations.
 */
export function createMockChat(): {
  provider: ChatProvider
  commandHandlers: Map<string, CommandHandler>
} {
  const commandHandlers = new Map<string, CommandHandler>()

  const provider: ChatProvider = {
    name: 'mock',
    registerCommand: (name: string, handler: CommandHandler): void => {
      commandHandlers.set(name, handler)
    },
    onMessage: (): void => {},
    sendMessage: (): Promise<void> => Promise.resolve(),
    start: (): Promise<void> => Promise.resolve(),
    stop: (): Promise<void> => Promise.resolve(),
  }

  return { provider, commandHandlers }
}

// ============================================================================
// ERROR ASSERTIONS
// ============================================================================

/**
 * Test helper to assert that an error is an AppError with expected user message.
 */
export function expectAppError(error: unknown, expectedMessage: string | RegExp): void {
  if (!(error instanceof Error)) {
    throw new Error(`Expected Error, got ${String(error)}`)
  }

  // Check if it's a classified error with appError property
  const classifiedError = error as Error & { appError?: AppError }
  if (classifiedError.appError === undefined) {
    throw new Error(`Error missing appError property: ${error.message}`)
  }

  const userMessage = getUserMessage(classifiedError.appError)

  if (typeof expectedMessage === 'string') {
    if (userMessage !== expectedMessage) {
      throw new Error(`Expected user message "${expectedMessage}", got "${userMessage}"`)
    }
  } else if (!expectedMessage.test(userMessage)) {
    throw new Error(`Expected user message to match ${expectedMessage.toString()}, got "${userMessage}"`)
  }
}
