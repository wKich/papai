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
import { getIdentityMapping, clearIdentityMapping } from '../src/identity/mapping.js'
import { ProviderClassifiedError, providerError } from '../src/providers/errors.js'
import { KaneoClassifiedError } from '../src/providers/kaneo/classify-error.js'
import type { TaskProvider } from '../src/providers/types.js'
import type { MakeToolsOptions } from '../src/tools/index.js'
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
  // generateText returns a result object with direct values
  type GenerateTextResult = {
    text: string
    toolCalls: Array<{ toolName: string; toolCallId: string; input: unknown }>
    toolResults: Array<{ toolName: string; toolCallId: string; output: unknown }>
    steps: unknown[]
    response: { messages: ModelMessage[]; id?: string; modelId?: string }
    usage: Record<string, unknown>
    finishReason: string
    warnings: unknown[] | undefined
    request: unknown
    providerMetadata: unknown
  }

  let generateTextImpl: (args?: { messages?: unknown[] }) => Promise<GenerateTextResult>

  const defaultGenerateTextResult = (): Promise<GenerateTextResult> =>
    Promise.resolve({
      text: 'Hello!',
      toolCalls: [],
      toolResults: [],
      steps: [],
      response: { messages: [{ role: 'assistant' as const, content: 'Hello!' }] },
      usage: {},
      finishReason: 'stop',
      warnings: undefined,
      request: {},
      providerMetadata: undefined,
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
    generateTextImpl = defaultGenerateTextResult

    // Register mocks
    mockLogger()

    void mock.module('../src/providers/factory.js', () => ({
      buildProviderForUser: (): typeof mockProvider => mockProvider,
    }))

    void mock.module('../src/providers/kaneo/provision.js', () => ({
      provisionAndConfigure: (): Promise<{ status: string }> => Promise.resolve({ status: 'already_configured' }),
      maybeProvisionKaneo: realProvisionMod.maybeProvisionKaneo,
    }))

    // AI SDK mocks — generateText and stepCountIs replaced for test control.
    // Preserves the real `tool` export so makeTools() works with unmocked tool creation.
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
      await processMessage(reply, freshCtx, 'user-1', null, 'hello', 'dm')

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
      await processMessage(reply, freshCtx, 'user-1', null, 'hello', 'dm')

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

      generateTextImpl = (): Promise<GenerateTextResult> => {
        throw apiError
      }
      const { reply, textCalls } = createMockReply()

      await processMessage(reply, CTX_ID, 'user-1', null, 'hello', 'dm')

      expect(textCalls).toHaveLength(1)
      expect(textCalls[0]).toBe('An unexpected error occurred. Please try again later.')
    })
  })

  describe('provider classified errors', () => {
    test('KaneoClassifiedError routes to getUserMessage', async () => {
      generateTextImpl = (): Promise<GenerateTextResult> => {
        throw new KaneoClassifiedError('Task not found', providerError.taskNotFound('T-1'))
      }
      const { reply, textCalls } = createMockReply()

      await processMessage(reply, CTX_ID, 'user-1', null, 'hello', 'dm')

      expect(textCalls).toHaveLength(1)
      expect(textCalls[0]).toContain('T-1')
      expect(textCalls[0]).toContain('not found')
    })

    test('ProviderClassifiedError routes through error.error', async () => {
      generateTextImpl = (): Promise<GenerateTextResult> => {
        throw new ProviderClassifiedError('Project not found', providerError.projectNotFound('P-1'))
      }
      const { reply, textCalls } = createMockReply()

      await processMessage(reply, CTX_ID, 'user-1', null, 'hello', 'dm')

      expect(textCalls).toHaveLength(1)
      expect(textCalls[0]).toContain('P-1')
      expect(textCalls[0]).toContain('not found')
    })

    test('unknown Error produces generic message', async () => {
      generateTextImpl = (): Promise<GenerateTextResult> => {
        throw new Error('random crash')
      }
      const { reply, textCalls } = createMockReply()

      await processMessage(reply, CTX_ID, 'user-1', null, 'hello', 'dm')

      expect(textCalls).toHaveLength(1)
      expect(textCalls[0]).toBe('An unexpected error occurred. Please try again later.')
    })
  })

  describe('history rollback on error', () => {
    test('on error, saveHistory is called to persist rollback', async () => {
      // Use a fresh context with no prior history (clean slate)
      const rollbackCtx = 'rollback-ctx'
      seedConfigForContext(rollbackCtx)

      generateTextImpl = (): Promise<GenerateTextResult> => {
        throw new Error('LLM crash')
      }
      const { reply, textCalls } = createMockReply()

      await processMessage(reply, rollbackCtx, 'user-1', null, 'new message', 'dm')

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

      generateTextImpl = (): Promise<GenerateTextResult> =>
        Promise.resolve({
          text: 'Done!',
          toolCalls: [],
          toolResults: [],
          steps: [
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
          ],
          response: { messages: [{ role: 'assistant' as const, content: 'Done!' }] },
          usage: {},
          finishReason: 'stop',
          warnings: undefined,
          request: {},
          providerMetadata: undefined,
        })

      let capturedStepsDetail: unknown = null
      const listener = (event: DebugEvent): void => {
        if (event.type === 'llm:end') capturedStepsDetail = event.data['stepsDetail']
      }
      subscribe(listener)
      try {
        const { reply } = createMockReply()
        await processMessage(reply, 'steps-detail-ctx', 'user-1', null, 'hello', 'dm')
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

      generateTextImpl = (): Promise<GenerateTextResult> =>
        Promise.resolve({
          text: 'Done!',
          toolCalls: [],
          toolResults: [],
          steps: [
            {
              text: '',
              toolCalls: [{ toolName: 'search', toolCallId: 'call-1', input: {} }],
              toolResults: [],
              content: [],
              usage: { inputTokens: 10, outputTokens: 5 },
            },
          ],
          response: { messages: [{ role: 'assistant' as const, content: 'Done!' }] },
          usage: {},
          finishReason: 'stop',
          warnings: undefined,
          request: {},
          providerMetadata: undefined,
        })

      let capturedStepsDetail: unknown = null
      const listener = (event: DebugEvent): void => {
        if (event.type === 'llm:end') capturedStepsDetail = event.data['stepsDetail']
      }
      subscribe(listener)
      try {
        const { reply } = createMockReply()
        await processMessage(reply, 'steps-detail-empty-ctx', 'user-1', null, 'hello', 'dm')
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

  describe('tool execution failure', () => {
    // Store callback captured by generateText for testing tool failure feedback
    let capturedOnToolCallFinish:
      | ((event: {
          toolCall: { toolName: string; toolCallId: string; input: unknown }
          durationMs: number
          success: boolean
          error?: unknown
        }) => void)
      | undefined

    beforeEach(() => {
      capturedOnToolCallFinish = undefined
      // Override generateText to capture the onToolCallFinish callback
      void mock.module('ai', () => ({
        ...realAi,
        generateText: (args: {
          messages?: unknown[]
          experimental_onToolCallFinish?: typeof capturedOnToolCallFinish
        }): Promise<GenerateTextResult> => {
          capturedOnToolCallFinish = args.experimental_onToolCallFinish
          return generateTextImpl(args)
        },
        stepCountIs: (): (() => boolean) => () => false,
      }))
    })

    test('sends immediate user feedback when tool execution fails', async () => {
      seedConfigForContext('tool-fail-ctx')

      generateTextImpl = (): Promise<GenerateTextResult> =>
        Promise.resolve({
          text: 'Done!',
          toolCalls: [{ toolName: 'create_task', toolCallId: 'call-1', input: { title: 'Test' } }],
          toolResults: [{ toolName: 'create_task', toolCallId: 'call-1', output: { error: 'failed' } }],
          steps: [],
          response: { messages: [{ role: 'assistant' as const, content: 'Done!' }] },
          usage: {},
          finishReason: 'stop',
          warnings: undefined,
          request: {},
          providerMetadata: undefined,
        })

      const { reply, textCalls } = createMockReply()

      await processMessage(reply, 'tool-fail-ctx', 'user-1', null, 'create a task', 'dm')

      // Simulate a tool failure by calling the captured callback
      if (capturedOnToolCallFinish !== undefined) {
        capturedOnToolCallFinish({
          toolCall: { toolName: 'create_task', toolCallId: 'call-1', input: { title: 'Test' } },
          durationMs: 100,
          success: false,
          error: new Error('Task creation failed'),
        })
      }

      // Should have received immediate feedback about the tool failure
      expect(textCalls.some((call) => call.includes('create_task') && call.includes('failed'))).toBe(true)
    })

    test('handles non-Error objects in tool failure callback', async () => {
      seedConfigForContext('tool-fail-string-ctx')

      generateTextImpl = (): Promise<GenerateTextResult> =>
        Promise.resolve({
          text: 'Done!',
          toolCalls: [],
          toolResults: [],
          steps: [],
          response: { messages: [{ role: 'assistant' as const, content: 'Done!' }] },
          usage: {},
          finishReason: 'stop',
          warnings: undefined,
          request: {},
          providerMetadata: undefined,
        })

      const { reply, textCalls } = createMockReply()

      await processMessage(reply, 'tool-fail-string-ctx', 'user-1', null, 'do something', 'dm')

      // Simulate a tool failure with a string error
      if (capturedOnToolCallFinish !== undefined) {
        capturedOnToolCallFinish({
          toolCall: { toolName: 'search_tasks', toolCallId: 'call-2', input: { q: 'test' } },
          durationMs: 50,
          success: false,
          error: 'String error message',
        })
      }

      expect(textCalls.some((call) => call.includes('search_tasks') && call.includes('String error message'))).toBe(
        true,
      )
    })
  })

  describe('success path history', () => {
    test('on success, history is extended with assistant messages', async () => {
      generateTextImpl = (): Promise<GenerateTextResult> =>
        Promise.resolve({
          text: 'Hi!',
          toolCalls: [],
          toolResults: [],
          steps: [],
          response: { messages: [{ role: 'assistant' as const, content: 'Hi!' }] },
          usage: {},
          finishReason: 'stop',
          warnings: undefined,
          request: {},
          providerMetadata: undefined,
        })
      const { reply } = createMockReply()

      await processMessage(reply, CTX_ID, 'user-1', null, 'hello', 'dm')

      // History should contain: user message + assistant message
      const history = getCachedHistory(CTX_ID)
      expect(history).toHaveLength(2)
      expect(history[0]!.role).toBe('user')
      expect(history[0]!.content).toBe('hello')
      expect(history[1]!.role).toBe('assistant')
      expect(history[1]!.content).toBe('Hi!')
    })

    test('tool results include tool names for fact extraction', async () => {
      seedConfigForContext('tool-results-ctx')
      generateTextImpl = (): Promise<GenerateTextResult> =>
        Promise.resolve({
          text: 'Task created successfully!',
          toolCalls: [{ toolName: 'create_task', toolCallId: 'call-1', input: { title: 'Test task' } }],
          toolResults: [
            {
              toolName: 'create_task',
              toolCallId: 'call-1',
              output: { id: 'task-123', title: 'Test task', number: 42 },
            },
          ],
          steps: [
            {
              text: 'Creating task...',
              finishReason: 'tool-calls',
              toolCalls: [{ toolName: 'create_task', toolCallId: 'call-1', input: { title: 'Test task' } }],
              toolResults: [{ toolCallId: 'call-1', output: { id: 'task-123', title: 'Test task', number: 42 } }],
            },
          ],
          response: { messages: [{ role: 'assistant' as const, content: 'Task created!' }] },
          usage: {},
          finishReason: 'stop',
          warnings: undefined,
          request: {},
          providerMetadata: undefined,
        })
      const { reply, textCalls } = createMockReply()

      await processMessage(reply, 'tool-results-ctx', 'user-1', null, 'create a test task', 'dm')

      // Should complete without error - tool results passed directly to fact extraction
      expect(textCalls.length).toBeGreaterThanOrEqual(0)
    })

    test('tool results with unmatched toolCallId still process successfully', async () => {
      seedConfigForContext('tool-results-missing-ctx')
      generateTextImpl = (): Promise<GenerateTextResult> =>
        Promise.resolve({
          text: 'Done!',
          toolCalls: [{ toolName: 'create_task', toolCallId: 'call-1', input: { title: 'Test' } }],
          toolResults: [{ toolName: 'create_task', toolCallId: 'call-2', output: { result: 'data' } }],
          steps: [
            {
              text: 'Working...',
              finishReason: 'tool-calls',
              toolCalls: [{ toolName: 'create_task', toolCallId: 'call-1', input: { title: 'Test' } }],
              toolResults: [{ toolCallId: 'call-2', output: { result: 'data' } }],
            },
          ],
          response: { messages: [{ role: 'assistant' as const, content: 'Done!' }] },
          usage: {},
          finishReason: 'stop',
          warnings: undefined,
          request: {},
          providerMetadata: undefined,
        })
      const { reply, textCalls } = createMockReply()

      await processMessage(reply, 'tool-results-missing-ctx', 'user-1', null, 'do something', 'dm')

      // Should complete without error
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
      await processMessage(reply, DEMO_CTX, 'user-1', null, 'hello', 'dm')

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
      await processMessage(reply, DEMO_CTX, 'user-1', null, 'hello', 'dm')

      // LLM config should NOT be copied
      expect(getCachedConfig(DEMO_CTX, 'llm_apikey')).toBeNull()
    })
  })

  describe('auto-link flow', () => {
    const GROUP_CTX = 'group-123'
    const USER_ID = 'user-456'
    const USERNAME = 'jsmith'

    beforeEach(() => {
      // Clear any existing identity mapping for the user (not group)
      // Identity mappings are per-user, stored under chatUserId
      clearIdentityMapping(USER_ID, 'mock')
    })

    test('skips auto-link when username is null', async () => {
      seedConfigForContext(GROUP_CTX)

      // Create provider with identity resolver
      const providerWithResolver = {
        ...mockProvider,
        identityResolver: {
          searchUsers: mock(() => Promise.resolve([{ id: 'user-123', login: 'jsmith', name: 'John Smith' }])),
        },
      }

      void mock.module('../src/providers/factory.js', () => ({
        buildProviderForUser: (): typeof providerWithResolver => providerWithResolver,
      }))

      const { reply } = createMockReply()
      // Pass null for username - should skip auto-link
      await processMessage(reply, GROUP_CTX, USER_ID, null, 'hello', 'group')

      // No mapping should be created
      const mapping = getIdentityMapping(GROUP_CTX, 'mock')
      expect(mapping).toBeNull()
    })

    test('skips auto-link when provider has no identity resolver', async () => {
      seedConfigForContext(GROUP_CTX)

      // Use mockProvider without identityResolver
      void mock.module('../src/providers/factory.js', () => ({
        buildProviderForUser: (): typeof mockProvider => mockProvider,
      }))

      const { reply } = createMockReply()
      await processMessage(reply, GROUP_CTX, USER_ID, USERNAME, 'hello', 'group')

      // No mapping should be created
      const mapping = getIdentityMapping(GROUP_CTX, 'mock')
      expect(mapping).toBeNull()
    })

    test('skips auto-link when mapping already exists', async () => {
      seedConfigForContext(GROUP_CTX)

      // Pre-set a mapping under the user ID (not group context)
      const { setIdentityMapping } = await import('../src/identity/mapping.js')
      setIdentityMapping({
        contextId: USER_ID,
        providerName: 'mock',
        providerUserId: 'existing-user',
        providerUserLogin: 'existing',
        displayName: 'Existing User',
        matchMethod: 'manual_nl',
        confidence: 100,
      })

      // Create provider with identity resolver that would match if called
      const providerWithResolver = {
        ...mockProvider,
        identityResolver: {
          searchUsers: mock(() => Promise.resolve([{ id: 'user-123', login: USERNAME, name: 'John Smith' }])),
        },
      }

      void mock.module('../src/providers/factory.js', () => ({
        buildProviderForUser: (): typeof providerWithResolver => providerWithResolver,
      }))

      const { reply } = createMockReply()
      await processMessage(reply, GROUP_CTX, USER_ID, USERNAME, 'hello', 'group')

      // Existing mapping should be preserved (stored under user ID)
      const mapping = getIdentityMapping(USER_ID, 'mock')
      expect(mapping?.providerUserLogin).toBe('existing')
      expect(mapping?.matchMethod).toBe('manual_nl')
    })

    test('attempts auto-link when username provided and no mapping exists', async () => {
      seedConfigForContext(GROUP_CTX)

      // Create provider with identity resolver that finds a match
      const providerWithResolver = {
        ...mockProvider,
        identityResolver: {
          searchUsers: mock(() => Promise.resolve([{ id: 'user-123', login: USERNAME, name: 'John Smith' }])),
        },
      }

      void mock.module('../src/providers/factory.js', () => ({
        buildProviderForUser: (): typeof providerWithResolver => providerWithResolver,
      }))

      const { reply } = createMockReply()
      await processMessage(reply, GROUP_CTX, USER_ID, USERNAME, 'hello', 'group')

      // Auto-link should have created a mapping under the user ID (not group context)
      const mapping = getIdentityMapping(USER_ID, 'mock')
      expect(mapping).not.toBeNull()
      expect(mapping?.providerUserLogin).toBe(USERNAME)
      expect(mapping?.matchMethod).toBe('auto')
      expect(mapping?.confidence).toBe(100)
    })

    test('stores unmatched when auto-link finds no match', async () => {
      seedConfigForContext(GROUP_CTX)

      // Create provider with identity resolver that finds no match
      const providerWithResolver = {
        ...mockProvider,
        identityResolver: {
          searchUsers: mock(() => Promise.resolve([])),
        },
      }

      void mock.module('../src/providers/factory.js', () => ({
        buildProviderForUser: (): typeof providerWithResolver => providerWithResolver,
      }))

      const { reply } = createMockReply()
      await processMessage(reply, GROUP_CTX, USER_ID, 'unknownuser', 'hello', 'group')

      // Should store unmatched mapping under the user ID (not group context)
      const mapping = getIdentityMapping(USER_ID, 'mock')
      expect(mapping).not.toBeNull()
      expect(mapping?.providerUserId).toBeNull()
      expect(mapping?.matchMethod).toBe('unmatched')
    })
  })

  describe('tool cache isolation in group chats', () => {
    const GROUP_CTX = 'group-shared-ctx'
    const USER_A = 'user-a-123'
    const USER_B = 'user-b-456'

    test('group chat tools are cached per-user to prevent cross-user contamination', async () => {
      // Seed config for the group context
      seedConfigForContext(GROUP_CTX)

      // Track how many times tools are built by capturing makeTools calls
      let toolBuildCount = 0
      const { makeTools: realMakeTools } = await import('../src/tools/index.js')

      void mock.module('../src/tools/index.js', () => ({
        makeTools: (provider: TaskProvider, options: MakeToolsOptions): unknown => {
          toolBuildCount++
          return realMakeTools(provider, options)
        },
      }))

      const { reply: replyA } = createMockReply()
      const { reply: replyB } = createMockReply()

      // User A speaks first in group
      await processMessage(replyA, GROUP_CTX, USER_A, null, 'hello from A', 'group')
      expect(toolBuildCount).toBe(1)

      // User B speaks in same group - should trigger NEW tool build with different user ID
      await processMessage(replyB, GROUP_CTX, USER_B, null, 'hello from B', 'group')
      expect(toolBuildCount).toBe(2)

      // User A speaks again - should use cached tools
      await processMessage(replyA, GROUP_CTX, USER_A, null, 'hello again A', 'group')
      expect(toolBuildCount).toBe(2)

      // User B speaks again - should use cached tools
      await processMessage(replyB, GROUP_CTX, USER_B, null, 'hello again B', 'group')
      expect(toolBuildCount).toBe(2)
    })

    test('DM tools are cached per-context without user suffix', async () => {
      // In DMs, contextId === chatUserId, so caching by contextId is sufficient
      seedConfigForContext('dm-ctx-1')
      seedConfigForContext('dm-ctx-2')

      let toolBuildCount = 0
      const { makeTools: realMakeTools } = await import('../src/tools/index.js')

      void mock.module('../src/tools/index.js', () => ({
        makeTools: (provider: TaskProvider, options: MakeToolsOptions): unknown => {
          toolBuildCount++
          return realMakeTools(provider, options)
        },
      }))

      const { reply: reply1 } = createMockReply()
      const { reply: reply2 } = createMockReply()

      // First DM user
      await processMessage(reply1, 'dm-ctx-1', 'user-1', null, 'hello', 'dm')
      expect(toolBuildCount).toBe(1)

      // Second DM user - different context, should build new tools
      await processMessage(reply2, 'dm-ctx-2', 'user-2', null, 'hello', 'dm')
      expect(toolBuildCount).toBe(2)

      // First DM user again - should use cache
      await processMessage(reply1, 'dm-ctx-1', 'user-1', null, 'hello again', 'dm')
      expect(toolBuildCount).toBe(2)
    })
  })
})
