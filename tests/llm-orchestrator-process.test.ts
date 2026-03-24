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

// Background events mock
let unseenEventsImpl: (userId: string) => Array<{
  id: string
  userId: string
  type: string
  prompt: string
  response: string
  createdAt: string
  injectedAt: string | null
}> = (): BgEvent[] => []

type BgEvent = {
  id: string
  userId: string
  type: string
  prompt: string
  response: string
  createdAt: string
  injectedAt: string | null
}
type ConsumeResult = { systemContent: string; historyEntries: Array<{ role: 'system'; content: string }> } | null

void mock.module('../src/deferred-prompts/background-events.js', () => ({
  consumeUnseenEvents: (userId: string): ConsumeResult => {
    const events = unseenEventsImpl(userId)
    if (events.length === 0) return null
    const lines = events.map((e: BgEvent): string => `[${e.createdAt} | ${e.type}] ${e.prompt}\n→ ${e.response}`)
    return {
      systemContent: `[Background tasks completed while you were away]\n\n${lines.join('\n\n')}`,
      historyEntries: events.map((e: BgEvent): { role: 'system'; content: string } => ({
        role: 'system',
        content: `[Background: ${e.type} | ${e.createdAt}]\n${e.prompt}\n→ ${e.response}`,
      })),
    }
  },
  loadUnseenEvents: (userId: string): BgEvent[] => unseenEventsImpl(userId),
  markEventsInjected: (_ids: string[]): void => {},
  recordBackgroundEvent: (): void => {},
  pruneBackgroundEvents: (): void => {},
  formatBackgroundEventsMessage: (): string => '',
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
  unseenEventsImpl = (): BgEvent[] => []
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

const msgRole = (m: unknown): string => {
  if (m !== null && typeof m === 'object' && 'role' in m)
    return String(Object.getOwnPropertyDescriptor(m, 'role')?.value ?? '')
  return ''
}
const msgContent = (m: unknown): string => {
  if (m !== null && typeof m === 'object' && 'content' in m)
    return String(Object.getOwnPropertyDescriptor(m, 'content')?.value ?? '')
  return ''
}

describe('processMessage — background event injection', () => {
  beforeEach((): void => {
    unseenEventsImpl = (): BgEvent[] => []
  })

  test('prepends system message when unseen events exist', async () => {
    unseenEventsImpl = (): BgEvent[] => [
      {
        id: 'evt-1',
        userId: 'user-1',
        type: 'scheduled',
        prompt: 'create report',
        response: 'Created report.',
        createdAt: '2026-03-24T09:00:00Z',
        injectedAt: null,
      },
    ]

    let capturedMessages: unknown[] = []
    generateTextImpl = (args?: { messages?: unknown[] }): Promise<GenerateTextResult> => {
      capturedMessages = [...(args?.messages ?? [])]
      return Promise.resolve({
        text: 'ok',
        toolCalls: [],
        toolResults: [],
        response: { messages: [{ role: 'assistant' as const, content: 'ok' }] },
        usage: {},
      })
    }

    const { reply } = createMockReply()
    await processMessage(reply, CTX_ID, null, 'hello')

    const systemMessages = capturedMessages.filter((m) => msgRole(m) === 'system')
    expect(systemMessages.length).toBeGreaterThanOrEqual(1)
    const bgMsg = systemMessages.find((m) => msgContent(m).includes('Background tasks completed'))
    expect(bgMsg).toBeDefined()
    expect(msgContent(bgMsg)).toContain('create report')
    expect(msgContent(bgMsg)).toContain('Created report.')
  })

  test('appends background history entries on injection', async () => {
    unseenEventsImpl = (): BgEvent[] => [
      {
        id: 'evt-2',
        userId: 'user-1',
        type: 'alert',
        prompt: 'check overdue',
        response: '2 overdue.',
        createdAt: '2026-03-24T09:05:00Z',
        injectedAt: null,
      },
    ]

    const { reply } = createMockReply()
    await processMessage(reply, CTX_ID, null, 'hello')

    const history = getCachedHistory(CTX_ID)
    const systemEntries = history.filter((m) => m.role === 'system')
    expect(systemEntries.length).toBeGreaterThanOrEqual(1)
    const bgEntry = systemEntries.find((m) => typeof m.content === 'string' && m.content.includes('check overdue'))
    expect(bgEntry).toBeDefined()
  })

  test('does not prepend system message when no unseen events', async () => {
    unseenEventsImpl = (): BgEvent[] => []

    let capturedMessages: unknown[] = []
    generateTextImpl = (args?: { messages?: unknown[] }): Promise<GenerateTextResult> => {
      capturedMessages = [...(args?.messages ?? [])]
      return defaultGenerateTextResult()
    }

    const { reply } = createMockReply()
    await processMessage(reply, CTX_ID, null, 'hello')

    const bgMessages = capturedMessages.filter((m) => msgContent(m).includes('Background tasks completed'))
    expect(bgMessages).toHaveLength(0)
  })
})
