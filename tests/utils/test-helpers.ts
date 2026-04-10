import { Database } from 'bun:sqlite'
import { mock } from 'bun:test'

import { drizzle } from 'drizzle-orm/bun-sqlite'

import type {
  AuthorizationResult,
  ChatCapability,
  ChatProvider,
  ChatProviderConfigRequirement,
  ChatProviderTraits,
  CommandHandler,
  IncomingInteraction,
  IncomingMessage,
  ReplyFn,
} from '../../src/chat/types.js'
import { _resetDrizzleDb, _setDrizzleDb } from '../../src/db/drizzle.js'
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
import { migration017MessageMetadata } from '../../src/db/migrations/017_message_metadata.js'
import { migration018Memos } from '../../src/db/migrations/018_memos.js'
import { migration019UserIdentityMappings } from '../../src/db/migrations/019_user_identity_mappings.js'
import * as schema from '../../src/db/schema.js'
import type { AppError } from '../../src/errors.js'
import { getUserMessage } from '../../src/errors.js'

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
  migration017MessageMetadata,
  migration018Memos,
  migration019UserIdentityMappings,
]

// ============================================================================
// MESSAGE CACHE TEST HELPERS
// ============================================================================

import type { CachedMessage } from '../../src/message-cache/types.js'

// Test-local message cache — fully isolated from production
const testMessageCache = new Map<string, CachedMessage>()
const ONE_WEEK_MS = 7 * 24 * 60 * 60 * 1000

function messageCacheKey(contextId: string, messageId: string): string {
  return `${contextId}:${messageId}`
}

/**
 * Mock the message cache module with a test-local implementation.
 * Call in describe-level beforeEach (NOT at top level) to avoid mock pollution.
 *
 * @example
 * describe('Feature', () => {
 *   beforeEach(() => {
 *     mockMessageCache()
 *   })
 * })
 */
export function mockMessageCache(): void {
  void mock.module('../../src/message-cache/cache.js', () => ({
    cacheMessage: (message: CachedMessage): void => {
      testMessageCache.set(messageCacheKey(message.contextId, message.messageId), message)
    },
    getCachedMessage: (contextId: string, messageId: string): CachedMessage | undefined => {
      const cached = testMessageCache.get(messageCacheKey(contextId, messageId))
      if (cached === undefined) return undefined
      if (Date.now() - cached.timestamp > ONE_WEEK_MS) {
        testMessageCache.delete(messageCacheKey(contextId, messageId))
        return undefined
      }
      return cached
    },
  }))
}

/**
 * Clear the test message cache between tests.
 */
export function clearMessageCache(): void {
  testMessageCache.clear()
}

/**
 * Check if a message exists in the test message cache.
 */
export function hasCachedMessage(contextId: string, messageId: string): boolean {
  const cached = testMessageCache.get(messageCacheKey(contextId, messageId))
  if (cached === undefined) return false
  if (Date.now() - cached.timestamp > ONE_WEEK_MS) {
    testMessageCache.delete(messageCacheKey(contextId, messageId))
    return false
  }
  return true
}

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
  _setDrizzleDb(testDb)
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
 * Inject a custom drizzle instance into the singleton.
 * Use this when tests create their own in-memory DB with custom schema
 * (e.g. without full migrations). For full-migration setup, use setupTestDb().
 */
export function setTestDrizzleDb(db: ReturnType<typeof drizzle<typeof schema>>): void {
  _setDrizzleDb(db)
}

/**
 * Reset the drizzle singleton back to its default (lazy-init) behavior.
 */
export function restoreDrizzle(): void {
  _resetDrizzleDb()
}

// Re-export logger mocks from dedicated file (no src/ imports to avoid mock timing issues)
export {
  createLoggerMock,
  createTrackedLoggerMock,
  mockLogger,
  type LogCall,
  type TrackedLoggerMock,
} from './logger-mock.js'

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
    buttons: (content: string): Promise<void> => {
      textCalls.push(content)
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

/** Default capability set for mock chat providers. */
export const DEFAULT_CHAT_CAPABILITIES = new Set<ChatCapability>([
  'commands.menu',
  'interactions.callbacks',
  'messages.buttons',
  'messages.files',
  'users.resolve',
])

/**
 * Create a mock chat provider with configurable behavior.
 * @param options - Optional configuration for the mock provider
 * @returns The mock ChatProvider and any captured state
 */
export function createMockChat(
  options: {
    /** Capture command handlers in this map */
    commandHandlers?: Map<string, CommandHandler>
    /** Custom sendMessage implementation */
    sendMessage?: (userId: string, text: string) => Promise<void>
    /** Callback when a message handler is registered via onMessage */
    onMessageHandler?: (handler: (msg: IncomingMessage, reply: ReplyFn) => Promise<void>) => void
    /** Custom resolveUserId implementation */
    resolveUserId?: (username: string) => Promise<string | null>
    /** Callback when an interaction handler is registered via onInteraction */
    onInteractionHandler?: (handler: (interaction: IncomingInteraction, reply: ReplyFn) => Promise<void>) => void
    /** Custom setCommands implementation */
    setCommands?: (adminUserId: string) => Promise<void>
    /** Capability set for this provider (defaults to DEFAULT_CHAT_CAPABILITIES) */
    capabilities?: Set<ChatCapability>
    /** Behavioral traits for this provider */
    traits?: ChatProviderTraits
    /** Config requirements for this provider */
    configRequirements?: ChatProviderConfigRequirement[]
  } = {},
): ChatProvider {
  return {
    name: 'mock',
    threadCapabilities: {
      supportsThreads: true,
      canCreateThreads: false,
      threadScope: 'message',
    },
    capabilities: options.capabilities ?? DEFAULT_CHAT_CAPABILITIES,
    traits: options.traits ?? { observedGroupMessages: 'all' },
    configRequirements: options.configRequirements ?? [],
    registerCommand: (name: string, handler: CommandHandler): void => {
      options.commandHandlers?.set(name, handler)
    },
    onMessage: (handler): void => {
      options.onMessageHandler?.(handler)
    },
    ...(options.onInteractionHandler === undefined
      ? {}
      : {
          onInteraction: (handler: (interaction: IncomingInteraction, reply: ReplyFn) => Promise<void>): void => {
            options.onInteractionHandler?.(handler)
          },
        }),
    sendMessage: options.sendMessage ?? ((): Promise<void> => Promise.resolve()),
    resolveUserId:
      options.resolveUserId ??
      ((username: string): Promise<string | null> => {
        const clean = username.startsWith('@') ? username.slice(1) : username
        return Promise.resolve(clean)
      }),
    setCommands: options.setCommands ?? ((): Promise<void> => Promise.resolve()),
    start: (): Promise<void> => Promise.resolve(),
    stop: (): Promise<void> => Promise.resolve(),
  }
}

/**
 * Create a mock chat provider that captures command registrations.
 */
export function createMockChatWithCommandHandlers(options: Parameters<typeof createMockChat>[0] = {}): {
  provider: ChatProvider
  commandHandlers: Map<string, CommandHandler>
} {
  const commandHandlers = new Map<string, CommandHandler>()
  const provider = createMockChat({ ...options, commandHandlers })
  return { provider, commandHandlers }
}

/**
 * Create a mock chat provider with custom sendMessage behavior and command handler capture.
 */
export function createMockChatWithHandler(sendMessageImpl: (userId: string, markdown: string) => Promise<void>): {
  mockChat: ChatProvider
  handlers: Map<string, CommandHandler>
} {
  const handlers = new Map<string, CommandHandler>()
  const mockChat = createMockChat({
    commandHandlers: handlers,
    sendMessage: sendMessageImpl,
  })
  return { mockChat, handlers }
}

/**
 * Create a mock chat provider for bot tests that captures the message handler.
 * Returns both the provider and a function to get the captured message handler.
 */
export function createMockChatForBot(): {
  provider: ChatProvider
  getMessageHandler: () => ((msg: IncomingMessage, reply: ReplyFn) => Promise<void>) | null
} {
  let messageHandler: ((msg: IncomingMessage, reply: ReplyFn) => Promise<void>) | null = null

  const provider = createMockChat({
    onMessageHandler: (handler): void => {
      messageHandler = handler
    },
  })

  return {
    provider,
    getMessageHandler: () => messageHandler,
  }
}

/**
 * Create a mock chat provider that tracks sent messages.
 * Returns the provider and a getter for sent messages.
 */
export function createMockChatWithSentMessages(): {
  provider: ChatProvider
  sentMessages: Array<{ userId: string; text: string }>
} {
  const sentMessages: Array<{ userId: string; text: string }> = []

  const provider = createMockChat({
    sendMessage: (userId: string, text: string): Promise<void> => {
      sentMessages.push({ userId, text })
      return Promise.resolve()
    },
  })

  return { provider, sentMessages }
}

// ============================================================================
// ERROR ASSERTIONS
// ============================================================================

// ============================================================================
// STATE COLLECTOR HELPERS
// ============================================================================

import { stats, pendingTraces, recentLlm } from '../../src/debug/state-collector.js'

/**
 * Reset debug stats and traces for testing.
 */
export function resetStats(): void {
  stats.startedAt = Date.now()
  stats.totalMessages = 0
  stats.totalLlmCalls = 0
  stats.totalToolCalls = 0
  pendingTraces.clear()
  recentLlm.length = 0
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

// ============================================================================
// TOOL TESTING HELPERS
// ============================================================================

interface SafeParseable {
  safeParse: (data: unknown) => { success: boolean }
}

function isSafeParseable(val: unknown): val is SafeParseable {
  return typeof val === 'object' && val !== null && 'safeParse' in val && typeof val.safeParse === 'function'
}

/** Test whether a tool's inputSchema accepts or rejects given data. */
export function schemaValidates(tool: { inputSchema: unknown }, data: unknown): boolean {
  const inputSchema = tool.inputSchema
  if (!isSafeParseable(inputSchema)) {
    throw new Error('Tool inputSchema does not have safeParse')
  }
  return inputSchema.safeParse(data).success
}

export interface ToolExecutor {
  execute: (...args: unknown[]) => Promise<unknown>
}

export function hasExecute(tool: unknown): tool is ToolExecutor {
  return (
    typeof tool === 'object' &&
    tool !== null &&
    'execute' in tool &&
    typeof (tool as Record<string, unknown>)['execute'] === 'function'
  )
}

export function getToolExecutor(tool: unknown): (...args: unknown[]) => Promise<unknown> {
  if (hasExecute(tool)) {
    return tool.execute
  }
  throw new Error('Tool does not have an execute method')
}

// ============================================================================
// MOCK DATA FACTORIES
// ============================================================================

import type { z } from 'zod'

import type { CreateLabelResponseSchema } from '../../src/providers/kaneo/schemas/create-label.js'
import { TaskSchema } from '../../src/providers/kaneo/schemas/create-task.js'
import type { ActivityItemSchema } from '../../src/providers/kaneo/schemas/get-activities.js'

type CreateTaskResponse = z.infer<typeof TaskSchema>
type CreateProjectResponse = {
  id: string
  workspaceId: string
  slug: string
  icon: string | null
  name: string
  description: string | null
  createdAt: unknown
  isPublic: boolean | null
}
type CreateLabelResponse = z.infer<typeof CreateLabelResponseSchema>
type ActivityItem = z.infer<typeof ActivityItemSchema>

type Column = {
  id: string
  name: string
  icon: string | null
  color: string | null
  isFinal: boolean
}

// Complete task mock matching CreateTaskResponseSchema
export function createMockTask(overrides: Partial<CreateTaskResponse> = {}): CreateTaskResponse {
  return {
    id: 'task-1',
    projectId: 'proj-1',
    position: 0,
    number: 42,
    userId: null,
    title: 'Test Task',
    description: 'Test description',
    status: 'todo',
    priority: 'medium',
    createdAt: '2026-03-01T00:00:00Z',
    dueDate: null,
    ...overrides,
  }
}

// Complete project mock matching CreateProjectResponseSchema
export function createMockProject(overrides: Partial<CreateProjectResponse> = {}): CreateProjectResponse {
  return {
    id: 'proj-1',
    workspaceId: 'ws-1',
    name: 'Test Project',
    slug: 'test-project',
    icon: null,
    description: null,
    createdAt: '2026-03-01T00:00:00Z',
    isPublic: false,
    ...overrides,
  }
}

// Complete label mock matching CreateLabelResponseSchema
export function createMockLabel(overrides: Partial<CreateLabelResponse> = {}): CreateLabelResponse {
  return {
    id: 'label-1',
    name: 'Bug',
    color: '#ff0000',
    createdAt: '2026-03-01T00:00:00Z',
    taskId: null,
    workspaceId: 'ws-1',
    ...overrides,
  }
}

// Complete activity mock matching CreateCommentResponseSchema (for add/update)
// or ActivityItemSchema (for list) - both have same structure
export function createMockActivity(overrides: Partial<ActivityItem> = {}): ActivityItem {
  return {
    id: 'act-1',
    taskId: 'task-1',
    type: 'comment',
    createdAt: '2026-03-01T00:00:00Z',
    userId: null,
    content: 'Test comment',
    externalUserName: null,
    externalUserAvatar: null,
    externalSource: null,
    externalUrl: null,
    ...overrides,
  }
}

// Complete column mock matching ColumnSchema
export function createMockColumn(overrides: Partial<Column> = {}): Column {
  return {
    id: 'col-1',
    name: 'To Do',
    icon: null,
    color: null,
    isFinal: false,
    ...overrides,
  }
}

// ============================================================================
// FETCH MOCK HELPERS
// ============================================================================

const originalFetch = globalThis.fetch

export function restoreFetch(): void {
  globalThis.fetch = originalFetch
}

/**
 * Replace globalThis.fetch with a mock handler for testing.
 * Wraps `mock()` internally so callers don't need `as unknown as` casts.
 */
export function setMockFetch(handler: (url: string, init: RequestInit) => Promise<Response>): void {
  const mocked = mock(handler)
  const wrapped = Object.assign(
    (input: string | URL | Request, init?: RequestInit): Promise<Response> => {
      const url = typeof input === 'string' ? input : input instanceof URL ? input.href : input.url
      return mocked(url, init ?? {})
    },
    { preconnect: originalFetch.preconnect },
  )
  globalThis.fetch = wrapped
}

// ============================================================================
// MODULE MOCK RESTORATION HELPERS
// ============================================================================

const originalModules = new Map<string, Record<string, unknown>>()

export function storeOriginalModule(path: string, original: Record<string, unknown>): void {
  if (!originalModules.has(path)) {
    originalModules.set(path, original)
  }
}

export function restoreModule(path: string): void {
  const original = originalModules.get(path)
  if (original !== undefined) {
    void mock.module(path, () => original)
    originalModules.delete(path)
  }
}

export function restoreAllModules(): void {
  for (const [path, original] of originalModules) {
    void mock.module(path, () => original)
  }
  originalModules.clear()
}

export async function flushMicrotasks(): Promise<void> {
  await new Promise<void>((resolve) => {
    queueMicrotask(() => {
      resolve()
    })
  })
  await new Promise<void>((resolve) => {
    setTimeout(() => {
      resolve()
    }, 0)
  })
}
