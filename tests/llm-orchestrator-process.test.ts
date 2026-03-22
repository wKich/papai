import { mock, describe, expect, test, beforeEach } from 'bun:test'

import { mockLogger, createMockReply } from './utils/test-helpers.js'

mockLogger()

// ---- Module mocks (before imports) ----

let configOverrides: Record<string, string | null> = {}
void mock.module('../src/config.js', () => ({
  getConfig: (_ctxId: string, key: string): string | null => {
    if (key in configOverrides) return configOverrides[key] ?? null
    const defaults: Record<string, string> = {
      llm_apikey: 'test-key',
      llm_baseurl: 'http://localhost:11434',
      main_model: 'test-model',
      kaneo_apikey: 'test-kaneo-key',
      timezone: 'UTC',
    }
    return defaults[key] ?? null
  },
  isConfigKey: (key: string): boolean =>
    ['llm_apikey', 'llm_baseurl', 'main_model', 'kaneo_apikey', 'timezone'].includes(key),
}))

import type { ModelMessage } from 'ai'

let cachedHistory: ModelMessage[] = []
const appendHistoryCalls: Array<{ ctxId: string; msgs: readonly ModelMessage[] }> = []
const saveHistoryCalls: Array<{ ctxId: string; msgs: readonly ModelMessage[] }> = []

void mock.module('../src/cache.js', () => ({
  getCachedHistory: (): ModelMessage[] => [...cachedHistory],
  getCachedTools: (): null => null,
  setCachedTools: (): void => {},
}))

void mock.module('../src/history.js', () => ({
  appendHistory: (ctxId: string, msgs: readonly ModelMessage[]): void => {
    appendHistoryCalls.push({ ctxId, msgs })
  },
  saveHistory: (ctxId: string, msgs: readonly ModelMessage[]): void => {
    saveHistoryCalls.push({ ctxId, msgs })
  },
  loadHistory: (): ModelMessage[] => [],
}))

void mock.module('../src/conversation.js', () => ({
  buildMessagesWithMemory: (
    _ctxId: string,
    history: readonly ModelMessage[],
  ): { messages: readonly ModelMessage[]; memoryMsg: null } => ({
    messages: history,
    memoryMsg: null,
  }),
  shouldTriggerTrim: (): boolean => false,
  runTrimInBackground: (): void => {},
}))

void mock.module('../src/memory.js', () => ({
  extractFactsFromSdkResults: (): unknown[] => [],
  upsertFact: (): void => {},
}))

const mockProvider = {
  name: 'mock',
  capabilities: new Set<string>(),
  getPromptAddendum: (): string => '',
}

void mock.module('../src/providers/registry.js', () => ({
  createProvider: (): typeof mockProvider => mockProvider,
}))

void mock.module('../src/tools/index.js', () => ({
  makeTools: (): Record<string, never> => ({}),
}))

void mock.module('../src/users.js', () => ({
  getKaneoWorkspace: (): string => 'workspace-1',
}))

void mock.module('../src/providers/kaneo/provision.js', () => ({
  provisionAndConfigure: (): Promise<{ status: string }> => Promise.resolve({ status: 'already_configured' }),
}))

// AI SDK mock — the key control point
type GenerateTextResult = {
  text: string
  toolCalls: never[]
  toolResults: never[]
  response: { messages: ModelMessage[] }
  usage: Record<string, unknown>
}

let generateTextImpl: () => Promise<GenerateTextResult> = () =>
  Promise.resolve({
    text: 'Hello!',
    toolCalls: [],
    toolResults: [],
    response: { messages: [{ role: 'assistant' as const, content: 'Hello!' }] },
    usage: {},
  })

void mock.module('ai', () => ({
  generateText: (): Promise<GenerateTextResult> => generateTextImpl(),
  stepCountIs: (): (() => boolean) => () => false,
}))

void mock.module('@ai-sdk/openai-compatible', () => ({
  createOpenAICompatible:
    (): ((_model: string) => string) =>
    (_model: string): string =>
      'mock-model',
}))

import { processMessage } from '../src/llm-orchestrator.js'
import { ProviderClassifiedError, providerError } from '../src/providers/errors.js'
import { KaneoClassifiedError } from '../src/providers/kaneo/classify-error.js'

const CTX_ID = 'ctx-1'

beforeEach(() => {
  configOverrides = {}
  cachedHistory = []
  appendHistoryCalls.length = 0
  saveHistoryCalls.length = 0
  generateTextImpl = (): Promise<GenerateTextResult> =>
    Promise.resolve({
      text: 'Hello!',
      toolCalls: [],
      toolResults: [],
      response: { messages: [{ role: 'assistant' as const, content: 'Hello!' }] },
      usage: {},
    })
})

describe('processMessage — missing configuration', () => {
  test('missing LLM config keys replies with key names and /set', async () => {
    configOverrides = { llm_apikey: null }
    const { reply, textCalls } = createMockReply()

    await processMessage(reply, CTX_ID, null, 'hello')

    // First reply is the missing config message, second is the error handler
    expect(textCalls.length).toBeGreaterThanOrEqual(1)
    expect(textCalls[0]).toContain('llm_apikey')
    expect(textCalls[0]).toContain('/set')
  })

  test('missing multiple config keys lists all in reply', async () => {
    configOverrides = { llm_apikey: null, main_model: null }
    const { reply, textCalls } = createMockReply()

    await processMessage(reply, CTX_ID, null, 'hello')

    expect(textCalls.length).toBeGreaterThanOrEqual(1)
    expect(textCalls[0]).toContain('llm_apikey')
    expect(textCalls[0]).toContain('main_model')
  })
})

describe('processMessage — LLM API error', () => {
  test('APICallError produces generic user-friendly reply', async () => {
    // Create an object that passes APICallError.isInstance() check
    const apiError = Object.assign(new Error('Rate limited'), {
      url: 'http://localhost',
      requestBodyValues: {},
      statusCode: 429,
      responseHeaders: {},
      responseBody: '',
      isRetryable: false,
      data: undefined,
    })
    // Mark it as an APICallError via the symbol-based check
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
  test('on error, history is rolled back to baseHistory', async () => {
    cachedHistory = [{ role: 'user', content: 'old' }]
    generateTextImpl = (): Promise<GenerateTextResult> => Promise.reject(new Error('LLM crash'))
    const { reply } = createMockReply()

    await processMessage(reply, CTX_ID, null, 'new message')

    // saveHistory should be called with the original baseHistory (without the new message)
    expect(saveHistoryCalls).toHaveLength(1)
    expect(saveHistoryCalls[0]!.ctxId).toBe(CTX_ID)
    expect(saveHistoryCalls[0]!.msgs).toEqual([{ role: 'user', content: 'old' }])
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

    // appendHistory should be called twice: once for the user message, once for the assistant
    expect(appendHistoryCalls.length).toBeGreaterThanOrEqual(2)
    // First call: user message
    expect(appendHistoryCalls[0]!.msgs).toEqual([{ role: 'user', content: 'hello' }])
    // Second call: assistant messages from result.response.messages
    expect(appendHistoryCalls[1]!.msgs).toEqual([{ role: 'assistant', content: 'Hi!' }])
  })
})
