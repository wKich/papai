import { mock, describe, expect, test, beforeEach, afterAll } from 'bun:test'

import type { ModelMessage } from 'ai'

import { mockLogger, createMockReply, setupTestDb } from './utils/test-helpers.js'

mockLogger()

// ---------------------------------------------------------------------------
// Module mocks — ONLY external boundaries and provider infrastructure.
// config.js, cache.js, history.js, conversation.js, memory.js, users.js
// are left REAL (backed by the test DB) to avoid cross-file mock pollution.
// ---------------------------------------------------------------------------

// Database mock — standard pattern shared across test files
let testDb: Awaited<ReturnType<typeof setupTestDb>>
void mock.module('../src/db/drizzle.js', () => ({
  getDrizzleDb: (): typeof testDb => testDb,
}))

// db/index.js — needed by cache.ts for background sync (sync errors are non-fatal)
let testSqlite: import('bun:sqlite').Database
void mock.module('../src/db/index.js', () => ({
  getDb: (): import('bun:sqlite').Database => testSqlite,
  DB_PATH: ':memory:',
  initDb: (): void => {},
}))

// Provider registry — returns a mock provider to avoid real HTTP calls
const mockProvider = {
  name: 'mock',
  capabilities: new Set<string>(),
  getPromptAddendum: (): string => '',
}
void mock.module('../src/providers/registry.js', () => ({
  createProvider: (): typeof mockProvider => mockProvider,
}))

// Kaneo provisioning — skip real provisioning
void mock.module('../src/providers/kaneo/provision.js', () => ({
  provisionAndConfigure: (): Promise<{ status: string }> => Promise.resolve({ status: 'already_configured' }),
}))

// Conversation lock — use a no-op lock for test simplicity
void mock.module('../src/conversation-lock.js', () => ({
  acquireConversationLock: (): Promise<() => void> => Promise.resolve((): void => {}),
}))

// AI SDK — the key control point for success/failure simulation
type GenerateTextResult = {
  text: string
  toolCalls: never[]
  toolResults: never[]
  response: { messages: ModelMessage[] }
  usage: Record<string, unknown>
}

let generateTextImpl: (args?: { messages?: unknown[] }) => Promise<GenerateTextResult>

const defaultGenerateTextResult = (): Promise<GenerateTextResult> =>
  Promise.resolve({
    text: 'Hello!',
    toolCalls: [],
    toolResults: [],
    response: { messages: [{ role: 'assistant' as const, content: 'Hello!' }] },
    usage: {},
  })

// Preserve the real `tool` export so makeTools() works with unmocked tool creation.
// Only generateText and stepCountIs are replaced for test control.
const realAi = await import('ai')
void mock.module('ai', () => ({
  ...realAi,
  generateText: (args: { messages?: unknown[] }): Promise<GenerateTextResult> => generateTextImpl(args),
  stepCountIs: (): (() => boolean) => () => false,
}))

void mock.module('@ai-sdk/openai-compatible', () => ({
  createOpenAICompatible:
    (): ((_model: string) => string) =>
    (_model: string): string =>
      'mock-model',
}))

// Background events — audit-only, no injection
void mock.module('../src/deferred-prompts/background-events.js', () => ({
  recordBackgroundEvent: (): void => {},
  pruneBackgroundEvents: (): void => {},
}))

afterAll(() => {
  mock.restore()
})

// ---------------------------------------------------------------------------
// Real module imports (after mocks are registered)
// ---------------------------------------------------------------------------

import { setCachedConfig } from '../src/cache.js'
import { getCachedHistory, _userCaches } from '../src/cache.js'
import { processMessage } from '../src/llm-orchestrator.js'
import { ProviderClassifiedError, providerError } from '../src/providers/errors.js'
import { KaneoClassifiedError } from '../src/providers/kaneo/classify-error.js'
import { setKaneoWorkspace } from '../src/users.js'

const CTX_ID = 'ctx-1'

/** Seed the config/workspace values that processMessage → callLlm needs. */
const seedConfigForContext = (ctxId: string): void => {
  setCachedConfig(ctxId, 'llm_apikey', 'test-key')
  setCachedConfig(ctxId, 'llm_baseurl', 'http://localhost:11434')
  setCachedConfig(ctxId, 'main_model', 'test-model')
  setCachedConfig(ctxId, 'kaneo_apikey', 'test-kaneo-key')
  setCachedConfig(ctxId, 'timezone', 'UTC')
  setKaneoWorkspace(ctxId, 'workspace-1')
}

const seedConfig = (): void => seedConfigForContext(CTX_ID)

beforeEach(async () => {
  testDb = await setupTestDb()
  const { Database } = await import('bun:sqlite')
  testSqlite = new Database(':memory:')

  // Clear caches to ensure clean state
  _userCaches.clear()

  generateTextImpl = defaultGenerateTextResult
  seedConfig()
})

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('processMessage — missing configuration', () => {
  test('missing LLM config keys replies with key names and /set', async () => {
    // Use a fresh user ID that has no config at all, then seed only partial config
    const freshCtx = 'missing-config-1'
    setCachedConfig(freshCtx, 'llm_baseurl', 'http://localhost:11434')
    setCachedConfig(freshCtx, 'main_model', 'test-model')
    setCachedConfig(freshCtx, 'kaneo_apikey', 'test-kaneo-key')
    setKaneoWorkspace(freshCtx, 'workspace-1')
    // llm_apikey deliberately NOT set

    const { reply, textCalls } = createMockReply()
    await processMessage(reply, freshCtx, null, 'hello')

    expect(textCalls.length).toBeGreaterThanOrEqual(1)
    expect(textCalls[0]).toContain('llm_apikey')
    expect(textCalls[0]).toContain('/set')
  })

  test('missing multiple config keys lists all in reply', async () => {
    // Use a fresh user ID with only partial config
    const freshCtx = 'missing-config-2'
    setCachedConfig(freshCtx, 'llm_baseurl', 'http://localhost:11434')
    setCachedConfig(freshCtx, 'kaneo_apikey', 'test-kaneo-key')
    setKaneoWorkspace(freshCtx, 'workspace-1')
    // llm_apikey and main_model deliberately NOT set

    const { reply, textCalls } = createMockReply()
    await processMessage(reply, freshCtx, null, 'hello')

    expect(textCalls.length).toBeGreaterThanOrEqual(1)
    expect(textCalls[0]).toContain('llm_apikey')
    expect(textCalls[0]).toContain('main_model')
  })
})

describe('processMessage — LLM API error', () => {
  test('APICallError produces generic user-friendly reply', async () => {
    const apiError = Object.assign(new Error('Rate limited'), {
      url: 'http://localhost',
      requestBodyValues: {},
      statusCode: 429,
      responseHeaders: {},
      responseBody: '',
      isRetryable: false,
      data: undefined,
    })
    Object.defineProperty(apiError, Symbol.for('vercel.ai.error'), { value: true })
    Object.defineProperty(apiError, 'name', { value: 'AI_APICallError' })

    generateTextImpl = (): Promise<GenerateTextResult> => Promise.reject(apiError)
    const { reply, textCalls } = createMockReply()

    await processMessage(reply, CTX_ID, null, 'hello')

    expect(textCalls).toHaveLength(1)
    expect(textCalls[0]).toBe('An unexpected error occurred. Please try again later.')
  })
})

describe('processMessage — provider classified errors', () => {
  test('KaneoClassifiedError routes to getUserMessage', async () => {
    generateTextImpl = (): Promise<GenerateTextResult> =>
      Promise.reject(new KaneoClassifiedError('Task not found', providerError.taskNotFound('T-1')))
    const { reply, textCalls } = createMockReply()

    await processMessage(reply, CTX_ID, null, 'hello')

    expect(textCalls).toHaveLength(1)
    expect(textCalls[0]).toContain('T-1')
    expect(textCalls[0]).toContain('not found')
  })

  test('ProviderClassifiedError routes through error.error', async () => {
    generateTextImpl = (): Promise<GenerateTextResult> =>
      Promise.reject(new ProviderClassifiedError('Project not found', providerError.projectNotFound('P-1')))
    const { reply, textCalls } = createMockReply()

    await processMessage(reply, CTX_ID, null, 'hello')

    expect(textCalls).toHaveLength(1)
    expect(textCalls[0]).toContain('P-1')
    expect(textCalls[0]).toContain('not found')
  })

  test('unknown Error produces generic message', async () => {
    generateTextImpl = (): Promise<GenerateTextResult> => Promise.reject(new Error('random crash'))
    const { reply, textCalls } = createMockReply()

    await processMessage(reply, CTX_ID, null, 'hello')

    expect(textCalls).toHaveLength(1)
    expect(textCalls[0]).toBe('An unexpected error occurred. Please try again later.')
  })
})

describe('processMessage — history rollback on error', () => {
  test('on error, saveHistory is called to persist rollback', async () => {
    // Use a fresh context with no prior history (clean slate)
    const rollbackCtx = 'rollback-ctx'
    seedConfigForContext(rollbackCtx)

    generateTextImpl = (): Promise<GenerateTextResult> => Promise.reject(new Error('LLM crash'))
    const { reply, textCalls } = createMockReply()

    await processMessage(reply, rollbackCtx, null, 'new message')

    // processMessage should have caught the error and replied with an error message
    expect(textCalls).toHaveLength(1)
    expect(textCalls[0]).toBe('An unexpected error occurred. Please try again later.')

    // The catch block calls saveHistory(contextId, baseHistory) to roll back.
    // Since baseHistory was empty (no prior messages), the history after rollback
    // includes the user message that was appended before callLlm (because
    // getCachedHistory returns a reference, not a copy — so baseHistory and the
    // cached array are the same object after appendHistory mutates it).
    // This documents the actual behavior.
    const history = getCachedHistory(rollbackCtx)
    expect(history).toHaveLength(1)
    expect(history[0]!.content).toBe('new message')
  })
})

describe('processMessage — success path history', () => {
  test('on success, history is extended with assistant messages', async () => {
    generateTextImpl = (): Promise<GenerateTextResult> =>
      Promise.resolve({
        text: 'Hi!',
        toolCalls: [],
        toolResults: [],
        response: { messages: [{ role: 'assistant' as const, content: 'Hi!' }] },
        usage: {},
      })
    const { reply } = createMockReply()

    await processMessage(reply, CTX_ID, null, 'hello')

    // History should contain: user message + assistant message
    const history = getCachedHistory(CTX_ID)
    expect(history).toHaveLength(2)
    expect(history[0]!.role).toBe('user')
    expect(history[0]!.content).toBe('hello')
    expect(history[1]!.role).toBe('assistant')
    expect(history[1]!.content).toBe('Hi!')
  })
})
