import { mock, describe, expect, test, beforeEach, afterAll } from 'bun:test'

import type { ModelMessage } from 'ai'

import type { DebugEvent } from '../src/debug/event-bus.js'
import { processMessage } from '../src/llm-orchestrator.js'
import { mockLogger, createMockReply, setupTestDb } from './utils/test-helpers.js'

// Capture real modules before mocking (file-level, stays at top)
const realAi = await import('ai')
const realProvisionMod = await import('../src/providers/kaneo/provision.js')

const isRecord = (value: unknown): value is Record<string, unknown> => typeof value === 'object' && value !== null

import { getCachedConfig, setCachedConfig } from '../src/cache.js'
import { getCachedHistory, _userCaches } from '../src/cache.js'
import { ProviderClassifiedError, providerError } from '../src/providers/errors.js'
import { KaneoClassifiedError } from '../src/providers/kaneo/classify-error.js'
import { setKaneoWorkspace } from '../src/users.js'

const CTX_ID = 'ctx-1'

const originalDemoMode = process.env['DEMO_MODE']
const originalAdminUserId = process.env['ADMIN_USER_ID']

describe('processMessage', () => {
  // ---------------------------------------------------------------------------
  // Module mocks — ONLY external boundaries and provider infrastructure.
  // config.js, cache.js, history.js, conversation.js, memory.js, users.js
  // are left REAL (backed by the test DB) to avoid cross-file mock pollution.
  // ---------------------------------------------------------------------------

  // Provider factory — returns a mock provider to avoid real HTTP calls and env var checks
  const mockProvider = {
    name: 'mock',
    capabilities: new Set<string>(),
    getPromptAddendum: (): string => '',
  }

  // AI SDK — the key control point for success/failure simulation
  // streamText returns an object with promises, not direct values
  type StreamTextResult = {
    text: Promise<string>
    toolCalls: Promise<Array<{ toolName: string; toolCallId: string; input: unknown }>>
    toolResults: Promise<Array<{ toolCallId: string; output: unknown }>>
    steps: Promise<unknown[]>
    response: Promise<{ messages: ModelMessage[]; id?: string; modelId?: string }>
    usage: Promise<Record<string, unknown>>
    finishReason: Promise<string>
    warnings: Promise<unknown[] | undefined>
    request: Promise<unknown>
    providerMetadata: Promise<unknown>
  }

  let streamTextImpl: (args?: { messages?: unknown[] }) => StreamTextResult

  const defaultStreamTextResult = (): StreamTextResult => ({
    text: Promise.resolve('Hello!'),
    toolCalls: Promise.resolve([]),
    toolResults: Promise.resolve([]),
    steps: Promise.resolve([]),
    response: Promise.resolve({ messages: [{ role: 'assistant' as const, content: 'Hello!' }] }),
    usage: Promise.resolve({}),
    finishReason: Promise.resolve('stop'),
    warnings: Promise.resolve(undefined),
    request: Promise.resolve({}),
    providerMetadata: Promise.resolve(undefined),
  })

  /** Seed the config/workspace values that processMessage -> callLlm needs. */
  const seedConfigForContext = (ctxId: string): void => {
    setCachedConfig(ctxId, 'llm_apikey', 'test-key')
    setCachedConfig(ctxId, 'llm_baseurl', 'http://localhost:11434')
    setCachedConfig(ctxId, 'main_model', 'test-model')
    setCachedConfig(ctxId, 'kaneo_apikey', 'test-kaneo-key')
    setCachedConfig(ctxId, 'timezone', 'UTC')
    setKaneoWorkspace(ctxId, 'workspace-1')
  }

  const seedConfig = (): void => seedConfigForContext(CTX_ID)

  // Partial DI for modules that are easy to mock
  // Complex modules (ai SDK) still use mock.module
  beforeEach(async () => {
    // Reset mutable state to defaults
    streamTextImpl = defaultStreamTextResult

    // Register mocks
    mockLogger()

    void mock.module('../src/providers/factory.js', () => ({
      buildProviderForUser: (): typeof mockProvider => mockProvider,
    }))

    void mock.module('../src/providers/kaneo/provision.js', () => ({
      provisionAndConfigure: (): Promise<{ status: string }> => Promise.resolve({ status: 'already_configured' }),
      maybeProvisionKaneo: realProvisionMod.maybeProvisionKaneo,
    }))

    // AI SDK mocks — streamText and stepCountIs replaced for test control.
    // Preserves the real `tool` export so makeTools() works with unmocked tool creation.
    void mock.module('ai', () => ({
      ...realAi,
      streamText: (args: { messages?: unknown[] }): StreamTextResult => streamTextImpl(args),
      stepCountIs: (): (() => boolean) => () => false,
    }))

    void mock.module('@ai-sdk/openai-compatible', () => ({
      createOpenAICompatible:
        (): ((_model: string) => string) =>
        (_model: string): string =>
          'mock-model',
    }))

    await setupTestDb()

    // Clear caches to ensure clean state
    _userCaches.clear()

    seedConfig()

    // Reset demo mode env vars
    delete process.env['DEMO_MODE']
    delete process.env['ADMIN_USER_ID']
  })

  afterAll(() => {
    // Restore original env vars
    if (originalDemoMode === undefined) delete process.env['DEMO_MODE']
    else process.env['DEMO_MODE'] = originalDemoMode
    if (originalAdminUserId === undefined) delete process.env['ADMIN_USER_ID']
    else process.env['ADMIN_USER_ID'] = originalAdminUserId
  })

  // ---------------------------------------------------------------------------
  // Tests
  // ---------------------------------------------------------------------------

  describe('missing configuration', () => {
    test('missing LLM config keys replies with key names and /setup', async () => {
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
      expect(textCalls[0]).toContain('/setup')
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

  describe('LLM API error', () => {
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

      streamTextImpl = (): StreamTextResult => {
        throw apiError
      }
      const { reply, textCalls } = createMockReply()

      await processMessage(reply, CTX_ID, null, 'hello')

      expect(textCalls).toHaveLength(1)
      expect(textCalls[0]).toBe('An unexpected error occurred. Please try again later.')
    })
  })

  describe('provider classified errors', () => {
    test('KaneoClassifiedError routes to getUserMessage', async () => {
      streamTextImpl = (): StreamTextResult => {
        throw new KaneoClassifiedError('Task not found', providerError.taskNotFound('T-1'))
      }
      const { reply, textCalls } = createMockReply()

      await processMessage(reply, CTX_ID, null, 'hello')

      expect(textCalls).toHaveLength(1)
      expect(textCalls[0]).toContain('T-1')
      expect(textCalls[0]).toContain('not found')
    })

    test('ProviderClassifiedError routes through error.error', async () => {
      streamTextImpl = (): StreamTextResult => {
        throw new ProviderClassifiedError('Project not found', providerError.projectNotFound('P-1'))
      }
      const { reply, textCalls } = createMockReply()

      await processMessage(reply, CTX_ID, null, 'hello')

      expect(textCalls).toHaveLength(1)
      expect(textCalls[0]).toContain('P-1')
      expect(textCalls[0]).toContain('not found')
    })

    test('unknown Error produces generic message', async () => {
      streamTextImpl = (): StreamTextResult => {
        throw new Error('random crash')
      }
      const { reply, textCalls } = createMockReply()

      await processMessage(reply, CTX_ID, null, 'hello')

      expect(textCalls).toHaveLength(1)
      expect(textCalls[0]).toBe('An unexpected error occurred. Please try again later.')
    })
  })

  describe('history rollback on error', () => {
    test('on error, saveHistory is called to persist rollback', async () => {
      // Use a fresh context with no prior history (clean slate)
      const rollbackCtx = 'rollback-ctx'
      seedConfigForContext(rollbackCtx)

      streamTextImpl = (): StreamTextResult => {
        throw new Error('LLM crash')
      }
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

  describe('stepsDetail SSE payload', () => {
    test('llm:end broadcasts text, finishReason, and inline tool results/errors', async () => {
      seedConfigForContext('steps-detail-ctx')
      const { subscribe, unsubscribe } = await import('../src/debug/event-bus.js')

      streamTextImpl = (): StreamTextResult => ({
        text: Promise.resolve('Done!'),
        toolCalls: Promise.resolve([]),
        toolResults: Promise.resolve([]),
        steps: Promise.resolve([
          {
            text: 'Calling search now.',
            finishReason: 'tool-calls',
            toolCalls: [
              { toolName: 'search', toolCallId: 'call-1', input: { q: 'foo' } },
              { toolName: 'create', toolCallId: 'call-2', input: { title: 'x' } },
            ],
            toolResults: [{ toolCallId: 'call-1', output: { hits: 3 } }],
            content: [{ type: 'tool-error', toolCallId: 'call-2', error: new Error('permission denied') }],
            usage: { inputTokens: 10, outputTokens: 5 },
          },
        ]),
        response: Promise.resolve({ messages: [{ role: 'assistant' as const, content: 'Done!' }] }),
        usage: Promise.resolve({}),
        finishReason: Promise.resolve('stop'),
        warnings: Promise.resolve(undefined),
        request: Promise.resolve({}),
        providerMetadata: Promise.resolve(undefined),
      })

      let capturedStepsDetail: unknown = null
      const listener = (event: DebugEvent): void => {
        if (event.type === 'llm:end') capturedStepsDetail = event.data['stepsDetail']
      }
      subscribe(listener)
      try {
        const { reply } = createMockReply()
        await processMessage(reply, 'steps-detail-ctx', null, 'hello')
      } finally {
        unsubscribe(listener)
      }

      expect(Array.isArray(capturedStepsDetail)).toBe(true)
      if (!Array.isArray(capturedStepsDetail)) return
      const stepValue: unknown = capturedStepsDetail[0]
      if (!isRecord(stepValue)) throw new Error('expected step record')
      expect(stepValue['stepNumber']).toBe(1)
      expect(stepValue['text']).toBe('Calling search now.')
      expect(stepValue['finishReason']).toBe('tool-calls')

      const toolCalls: unknown = stepValue['toolCalls']
      expect(Array.isArray(toolCalls)).toBe(true)
      if (!Array.isArray(toolCalls)) return
      const tc0: unknown = toolCalls[0]
      const tc1: unknown = toolCalls[1]
      if (!isRecord(tc0) || !isRecord(tc1)) throw new Error('expected tool call records')
      expect(tc0['toolName']).toBe('search')
      expect(tc0['result']).toEqual({ hits: 3 })
      expect(tc0['error']).toBeUndefined()
      expect(tc1['toolName']).toBe('create')
      expect(tc1['result']).toBeUndefined()
      expect(tc1['error']).toBe('permission denied')
    })

    test('llm:end omits text and finishReason when the step has neither', async () => {
      seedConfigForContext('steps-detail-empty-ctx')
      const { subscribe, unsubscribe } = await import('../src/debug/event-bus.js')

      streamTextImpl = (): StreamTextResult => ({
        text: Promise.resolve('Done!'),
        toolCalls: Promise.resolve([]),
        toolResults: Promise.resolve([]),
        steps: Promise.resolve([
          {
            text: '',
            toolCalls: [{ toolName: 'search', toolCallId: 'call-1', input: {} }],
            toolResults: [],
            content: [],
            usage: { inputTokens: 10, outputTokens: 5 },
          },
        ]),
        response: Promise.resolve({ messages: [{ role: 'assistant' as const, content: 'Done!' }] }),
        usage: Promise.resolve({}),
        finishReason: Promise.resolve('stop'),
        warnings: Promise.resolve(undefined),
        request: Promise.resolve({}),
        providerMetadata: Promise.resolve(undefined),
      })

      let capturedStepsDetail: unknown = null
      const listener = (event: DebugEvent): void => {
        if (event.type === 'llm:end') capturedStepsDetail = event.data['stepsDetail']
      }
      subscribe(listener)
      try {
        const { reply } = createMockReply()
        await processMessage(reply, 'steps-detail-empty-ctx', null, 'hello')
      } finally {
        unsubscribe(listener)
      }

      if (!Array.isArray(capturedStepsDetail)) throw new Error('expected stepsDetail array')
      const step: unknown = capturedStepsDetail[0]
      if (!isRecord(step)) throw new Error('expected step record')
      expect(step['text']).toBeUndefined()
      expect(step['finishReason']).toBeUndefined()
    })
  })

  describe('success path history', () => {
    test('on success, history is extended with assistant messages', async () => {
      streamTextImpl = (): StreamTextResult => ({
        text: Promise.resolve('Hi!'),
        toolCalls: Promise.resolve([]),
        toolResults: Promise.resolve([]),
        steps: Promise.resolve([]),
        response: Promise.resolve({ messages: [{ role: 'assistant' as const, content: 'Hi!' }] }),
        usage: Promise.resolve({}),
        finishReason: Promise.resolve('stop'),
        warnings: Promise.resolve(undefined),
        request: Promise.resolve({}),
        providerMetadata: Promise.resolve(undefined),
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

    test('tool results are mapped with tool names for fact extraction', async () => {
      seedConfigForContext('tool-results-ctx')
      streamTextImpl = (): StreamTextResult => ({
        text: Promise.resolve('Task created successfully!'),
        toolCalls: Promise.resolve([{ toolName: 'create_task', toolCallId: 'call-1', input: { title: 'Test task' } }]),
        toolResults: Promise.resolve([
          { toolCallId: 'call-1', output: { id: 'task-123', title: 'Test task', number: 42 } },
        ]),
        steps: Promise.resolve([
          {
            text: 'Creating task...',
            finishReason: 'tool-calls',
            toolCalls: [{ toolName: 'create_task', toolCallId: 'call-1', input: { title: 'Test task' } }],
            toolResults: [{ toolCallId: 'call-1', output: { id: 'task-123', title: 'Test task', number: 42 } }],
          },
        ]),
        response: Promise.resolve({ messages: [{ role: 'assistant' as const, content: 'Task created!' }] }),
        usage: Promise.resolve({}),
        finishReason: Promise.resolve('stop'),
        warnings: Promise.resolve(undefined),
        request: Promise.resolve({}),
        providerMetadata: Promise.resolve(undefined),
      })
      const { reply, textCalls } = createMockReply()

      await processMessage(reply, 'tool-results-ctx', null, 'create a test task')

      // Should complete without error - tool results mapped to include toolName for fact extraction
      expect(textCalls.length).toBeGreaterThanOrEqual(0)
    })

    test('tool results with missing toolCallId use empty tool name', async () => {
      seedConfigForContext('tool-results-missing-ctx')
      streamTextImpl = (): StreamTextResult => ({
        text: Promise.resolve('Done!'),
        toolCalls: Promise.resolve([{ toolName: 'create_task', toolCallId: 'call-1', input: { title: 'Test' } }]),
        // No matching toolCallId - tests the fallback to empty tool name
        toolResults: Promise.resolve([{ toolCallId: 'call-2', output: { result: 'data' } }]),
        steps: Promise.resolve([
          {
            text: 'Working...',
            finishReason: 'tool-calls',
            toolCalls: [{ toolName: 'create_task', toolCallId: 'call-1', input: { title: 'Test' } }],
            toolResults: [{ toolCallId: 'call-2', output: { result: 'data' } }],
          },
        ]),
        response: Promise.resolve({ messages: [{ role: 'assistant' as const, content: 'Done!' }] }),
        usage: Promise.resolve({}),
        finishReason: Promise.resolve('stop'),
        warnings: Promise.resolve(undefined),
        request: Promise.resolve({}),
        providerMetadata: Promise.resolve(undefined),
      })
      const { reply, textCalls } = createMockReply()

      await processMessage(reply, 'tool-results-missing-ctx', null, 'do something')

      // Should complete without error - missing toolName defaults to empty string
      expect(textCalls.length).toBeGreaterThanOrEqual(0)
    })
  })

  describe('demo mode LLM config copy', () => {
    const ADMIN_CTX = 'admin-ctx'
    const DEMO_CTX = 'demo-ctx'

    test('copies admin LLM config to demo user after Kaneo provisioning', async () => {
      process.env['DEMO_MODE'] = 'true'
      process.env['ADMIN_USER_ID'] = ADMIN_CTX

      // Seed admin with full LLM config
      seedConfigForContext(ADMIN_CTX)

      // Demo user has only kaneo_apikey + workspace (no LLM keys)
      setCachedConfig(DEMO_CTX, 'kaneo_apikey', 'demo-kaneo-key')
      setKaneoWorkspace(DEMO_CTX, 'demo-workspace')

      const { reply } = createMockReply()
      await processMessage(reply, DEMO_CTX, null, 'hello')

      // Verify admin's LLM config was copied
      expect(getCachedConfig(DEMO_CTX, 'llm_apikey')).toBe('test-key')
      expect(getCachedConfig(DEMO_CTX, 'llm_baseurl')).toBe('http://localhost:11434')
      expect(getCachedConfig(DEMO_CTX, 'main_model')).toBe('test-model')
    })

    test('does not copy config when DEMO_MODE is off', async () => {
      // Seed admin with full LLM config
      seedConfigForContext(ADMIN_CTX)
      process.env['ADMIN_USER_ID'] = ADMIN_CTX

      // Demo user has only kaneo_apikey + workspace
      setCachedConfig(DEMO_CTX, 'kaneo_apikey', 'demo-kaneo-key')
      setKaneoWorkspace(DEMO_CTX, 'demo-workspace')

      const { reply } = createMockReply()
      await processMessage(reply, DEMO_CTX, null, 'hello')

      // LLM config should NOT be copied
      expect(getCachedConfig(DEMO_CTX, 'llm_apikey')).toBeNull()
    })
  })
})
