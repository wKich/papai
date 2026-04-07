// tests/deferred-prompts/execution-modes.test.ts
//
// Mocked modules: ai, @ai-sdk/openai-compatible, ../src/logger.js
// (Uses mockLogger + setupTestDb helpers; mocks ai + openai-compatible in beforeEach)
import { beforeEach, describe, expect, mock, test } from 'bun:test'

import type { ModelMessage } from 'ai'

import { setConfig } from '../../src/config.js'
import { dispatchExecution } from '../../src/deferred-prompts/proactive-llm.js'
import type { ExecutionMetadata } from '../../src/deferred-prompts/types.js'
import { appendHistory } from '../../src/history.js'
import { createMockProvider } from '../tools/mock-provider.js'
import { mockLogger, setupTestDb } from '../utils/test-helpers.js'

// Track streamText calls
type StreamTextResult = {
  text: Promise<string>
  toolCalls: Promise<unknown[]>
  toolResults: Promise<unknown[]>
  steps: Promise<unknown[]>
  response: Promise<{ messages: ModelMessage[] }>
  usage: Promise<Record<string, unknown>>
  finishReason: Promise<string>
  warnings: Promise<unknown[] | undefined>
  request: Promise<unknown>
  providerMetadata: Promise<unknown>
}
type StreamTextCall = { model: string; system: string; messages: ModelMessage[]; tools: unknown }

const USER_ID = 'exec-mode-user'

function setupUserConfig(opts?: { smallModel?: string }): void {
  setConfig(USER_ID, 'llm_apikey', 'test-key')
  setConfig(USER_ID, 'llm_baseurl', 'http://localhost:11434/v1')
  setConfig(USER_ID, 'main_model', 'main-model')
  setConfig(USER_ID, 'timezone', 'UTC')
  if (opts?.smallModel !== undefined) {
    setConfig(USER_ID, 'small_model', opts.smallModel)
  }
}

describe('dispatchExecution', () => {
  const streamTextCalls: StreamTextCall[] = []

  let streamTextImpl = (): StreamTextResult => {
    return {
      text: Promise.resolve('Mock response'),
      toolCalls: Promise.resolve([]),
      toolResults: Promise.resolve([]),
      steps: Promise.resolve([]),
      response: Promise.resolve({ messages: [] }),
      usage: Promise.resolve({}),
      finishReason: Promise.resolve('stop'),
      warnings: Promise.resolve(undefined),
      request: Promise.resolve({}),
      providerMetadata: Promise.resolve(undefined),
    }
  }

  beforeEach(async () => {
    mockLogger()
    streamTextCalls.length = 0
    streamTextImpl = (): StreamTextResult => {
      return {
        text: Promise.resolve('Mock response'),
        toolCalls: Promise.resolve([]),
        toolResults: Promise.resolve([]),
        steps: Promise.resolve([]),
        response: Promise.resolve({ messages: [] }),
        usage: Promise.resolve({}),
        finishReason: Promise.resolve('stop'),
        warnings: Promise.resolve(undefined),
        request: Promise.resolve({}),
        providerMetadata: Promise.resolve(undefined),
      }
    }
    void mock.module('ai', () => ({
      streamText: (_args: StreamTextCall): StreamTextResult => {
        streamTextCalls.push(_args)
        return streamTextImpl()
      },
      tool: (opts: unknown): unknown => opts,
      stepCountIs: (_n: number): unknown => undefined,
    }))
    void mock.module('@ai-sdk/openai-compatible', () => ({
      createOpenAICompatible:
        (opts: { name: string; apiKey: string; baseURL: string }): ((modelId: string) => string) =>
        (modelId: string): string =>
          `${opts.name}:${modelId}`,
    }))
    await setupTestDb()
  })

  describe('lightweight mode', () => {
    const metadata: ExecutionMetadata = {
      mode: 'lightweight',
      delivery_brief: 'Friendly hydration reminder',
      context_snapshot: null,
    }

    test('uses small_model when configured', async () => {
      setupUserConfig({ smallModel: 'small-model' })
      await dispatchExecution(USER_ID, 'scheduled', 'drink water', metadata, () => null)
      expect(streamTextCalls).toHaveLength(1)
      expect(streamTextCalls[0]!.model).toContain('small-model')
    })

    test('falls back to main_model when small_model not set', async () => {
      setupUserConfig()
      await dispatchExecution(USER_ID, 'scheduled', 'drink water', metadata, () => null)
      expect(streamTextCalls).toHaveLength(1)
      expect(streamTextCalls[0]!.model).toContain('main-model')
    })

    test('includes get_current_time tool only', async () => {
      setupUserConfig()
      await dispatchExecution(USER_ID, 'scheduled', 'drink water', metadata, () => null)
      expect(streamTextCalls[0]!.tools).toBeDefined()
      expect(streamTextCalls[0]!.tools).toHaveProperty('get_current_time')
      // Should not have task-related tools in lightweight mode
      expect(streamTextCalls[0]!.tools).not.toHaveProperty('create_task')
    })

    test('uses minimal system prompt', async () => {
      setupUserConfig()
      await dispatchExecution(USER_ID, 'scheduled', 'drink water', metadata, () => null)
      const system = streamTextCalls[0]!.system
      expect(system).toContain('[PROACTIVE EXECUTION]')
      expect(system).not.toContain('DEFERRED PROMPTS')
    })

    test('includes delivery brief in messages', async () => {
      setupUserConfig()
      await dispatchExecution(USER_ID, 'scheduled', 'drink water', metadata, () => null)
      const messages = streamTextCalls[0]!.messages
      const systemMsgs = messages.filter((m) => m.role === 'system')
      expect(systemMsgs.some((m) => typeof m.content === 'string' && m.content.includes('[DELIVERY BRIEF]'))).toBe(true)
      expect(
        systemMsgs.some((m) => typeof m.content === 'string' && m.content.includes('Friendly hydration reminder')),
      ).toBe(true)
    })

    test('wraps prompt in deferred task delimiters', async () => {
      setupUserConfig()
      await dispatchExecution(USER_ID, 'scheduled', 'drink water', metadata, () => null)
      const messages = streamTextCalls[0]!.messages
      const userMsgs = messages.filter((m) => m.role === 'user')
      expect(userMsgs.some((m) => typeof m.content === 'string' && m.content.includes('===DEFERRED_TASK==='))).toBe(
        true,
      )
      expect(userMsgs.some((m) => typeof m.content === 'string' && m.content.includes('drink water'))).toBe(true)
    })

    test('does not load conversation history', async () => {
      setupUserConfig()
      appendHistory(USER_ID, [{ role: 'user', content: 'old message' }])
      await dispatchExecution(USER_ID, 'scheduled', 'drink water', metadata, () => null)
      const messages = streamTextCalls[0]!.messages
      expect(messages.some((m) => typeof m.content === 'string' && m.content.includes('old message'))).toBe(false)
    })

    test('includes context snapshot when present', async () => {
      setupUserConfig()
      const withSnapshot: ExecutionMetadata = { ...metadata, context_snapshot: 'User discussed migration' }
      await dispatchExecution(USER_ID, 'scheduled', 'remind about migration', withSnapshot, () => null)
      const messages = streamTextCalls[0]!.messages
      const systemMsgs = messages.filter((m) => m.role === 'system')
      expect(
        systemMsgs.some((m) => typeof m.content === 'string' && m.content.includes('[CONTEXT FROM CREATION TIME]')),
      ).toBe(true)
    })

    test('omits context snapshot message when null', async () => {
      setupUserConfig()
      await dispatchExecution(USER_ID, 'scheduled', 'drink water', metadata, () => null)
      const messages = streamTextCalls[0]!.messages
      expect(
        messages.some(
          (m) => typeof m.content === 'string' && String(m.content).includes('[CONTEXT FROM CREATION TIME]'),
        ),
      ).toBe(false)
    })
  })

  describe('context mode', () => {
    const metadata: ExecutionMetadata = {
      mode: 'context',
      delivery_brief: 'Remind about the standup discussion',
      context_snapshot: 'Discussed Q2 sprint priorities',
    }

    test('uses main_model', async () => {
      setupUserConfig()
      await dispatchExecution(USER_ID, 'scheduled', 'standup reminder', metadata, () => null)
      expect(streamTextCalls[0]!.model).toContain('main-model')
    })

    test('loads conversation history', async () => {
      setupUserConfig()
      appendHistory(USER_ID, [{ role: 'user', content: 'history message' }])
      await dispatchExecution(USER_ID, 'scheduled', 'standup reminder', metadata, () => null)
      const messages = streamTextCalls[0]!.messages
      expect(messages.some((m) => typeof m.content === 'string' && m.content.includes('history message'))).toBe(true)
    })

    test('includes get_current_time tool only', async () => {
      setupUserConfig()
      await dispatchExecution(USER_ID, 'scheduled', 'standup reminder', metadata, () => null)
      expect(streamTextCalls[0]!.tools).toBeDefined()
      expect(streamTextCalls[0]!.tools).toHaveProperty('get_current_time')
      // Should not have task-related tools in context mode
      expect(streamTextCalls[0]!.tools).not.toHaveProperty('create_task')
    })

    test('uses minimal system prompt', async () => {
      setupUserConfig()
      await dispatchExecution(USER_ID, 'scheduled', 'standup reminder', metadata, () => null)
      const system = streamTextCalls[0]!.system
      expect(system).toContain('[PROACTIVE EXECUTION]')
    })
  })

  describe('full mode', () => {
    const metadata: ExecutionMetadata = {
      mode: 'full',
      delivery_brief: 'Check overdue tasks grouped by project',
      context_snapshot: null,
    }

    test('uses main_model', async () => {
      setupUserConfig()
      const provider = createMockProvider()
      await dispatchExecution(USER_ID, 'scheduled', 'check overdue', metadata, () => provider)
      expect(streamTextCalls[0]!.model).toContain('main-model')
    })

    test('includes tools', async () => {
      setupUserConfig()
      const provider = createMockProvider()
      await dispatchExecution(USER_ID, 'scheduled', 'check overdue', metadata, () => provider)
      expect(streamTextCalls[0]!.tools).toBeDefined()
    })

    test('uses full system prompt', async () => {
      setupUserConfig()
      const provider = createMockProvider()
      await dispatchExecution(USER_ID, 'scheduled', 'check overdue', metadata, () => provider)
      const system = streamTextCalls[0]!.system
      // Full system prompt includes provider-specific content
      expect(system.length).toBeGreaterThan(200)
    })

    test('loads conversation history', async () => {
      setupUserConfig()
      const provider = createMockProvider()
      appendHistory(USER_ID, [{ role: 'user', content: 'full mode history' }])
      await dispatchExecution(USER_ID, 'scheduled', 'check overdue', metadata, () => provider)
      const messages = streamTextCalls[0]!.messages
      expect(messages.some((m) => typeof m.content === 'string' && m.content.includes('full mode history'))).toBe(true)
    })

    test('returns error when provider cannot be built', async () => {
      setupUserConfig()
      const result = await dispatchExecution(USER_ID, 'scheduled', 'check overdue', metadata, () => null)
      expect(result).toContain('task provider not configured')
    })
  })

  describe('fallback behavior', () => {
    test('treats empty metadata as full mode', async () => {
      setupUserConfig()
      const emptyMetadata: ExecutionMetadata = { mode: 'full', delivery_brief: '', context_snapshot: null }
      const provider = createMockProvider()
      await dispatchExecution(USER_ID, 'scheduled', 'test', emptyMetadata, () => provider)
      expect(streamTextCalls[0]!.tools).toBeDefined()
    })
  })

  describe('missing config handling', () => {
    test('returns error message when LLM config is missing', async () => {
      // Don't set up config
      const metadata: ExecutionMetadata = {
        mode: 'lightweight',
        delivery_brief: 'Test',
        context_snapshot: null,
      }
      const result = await dispatchExecution('unconfigured-user', 'scheduled', 'test', metadata, () => null)
      expect(result).toContain('missing LLM configuration')
      expect(result).toContain('/setup')
    })

    test('returns error message when apiKey is missing', async () => {
      setConfig('no-api-key', 'llm_baseurl', 'http://localhost:11434/v1')
      setConfig('no-api-key', 'main_model', 'main-model')
      // Missing llm_apikey

      const metadata: ExecutionMetadata = {
        mode: 'lightweight',
        delivery_brief: 'Test',
        context_snapshot: null,
      }
      const result = await dispatchExecution('no-api-key', 'scheduled', 'test', metadata, () => null)
      expect(result).toContain('missing LLM configuration')
    })

    test('returns error message when baseURL is missing', async () => {
      setConfig('no-baseurl', 'llm_apikey', 'test-key')
      setConfig('no-baseurl', 'main_model', 'main-model')
      // Missing llm_baseurl

      const metadata: ExecutionMetadata = {
        mode: 'lightweight',
        delivery_brief: 'Test',
        context_snapshot: null,
      }
      const result = await dispatchExecution('no-baseurl', 'scheduled', 'test', metadata, () => null)
      expect(result).toContain('missing LLM configuration')
    })

    test('returns error message when main_model is missing', async () => {
      setConfig('no-model', 'llm_apikey', 'test-key')
      setConfig('no-model', 'llm_baseurl', 'http://localhost:11434/v1')
      // Missing main_model

      const metadata: ExecutionMetadata = {
        mode: 'lightweight',
        delivery_brief: 'Test',
        context_snapshot: null,
      }
      const result = await dispatchExecution('no-model', 'scheduled', 'test', metadata, () => null)
      expect(result).toContain('missing LLM configuration')
    })
  })

  describe('lightweight mode with assistant messages', () => {
    const metadata: ExecutionMetadata = {
      mode: 'lightweight',
      delivery_brief: 'Test',
      context_snapshot: null,
    }

    test('appends assistant response to history', async () => {
      streamTextImpl = (): StreamTextResult => ({
        text: Promise.resolve('Assistant response'),
        toolCalls: Promise.resolve([]),
        toolResults: Promise.resolve([]),
        response: Promise.resolve({
          messages: [{ role: 'assistant' as const, content: 'Assistant response' }],
        }),
        steps: Promise.resolve([]),
        usage: Promise.resolve({}),
        finishReason: Promise.resolve('stop'),
        warnings: Promise.resolve(undefined),
        request: Promise.resolve({}),
        providerMetadata: Promise.resolve(undefined),
      })

      setupUserConfig()
      const result = await dispatchExecution(USER_ID, 'scheduled', 'test', metadata, () => null)

      expect(result).toBe('Assistant response')
    })

    test('handles empty text response', async () => {
      streamTextImpl = (): StreamTextResult => ({
        text: Promise.resolve(''),
        toolCalls: Promise.resolve([]),
        toolResults: Promise.resolve([]),
        response: Promise.resolve({
          messages: [{ role: 'assistant' as const, content: '' }],
        }),
        steps: Promise.resolve([]),
        usage: Promise.resolve({}),
        finishReason: Promise.resolve('stop'),
        warnings: Promise.resolve(undefined),
        request: Promise.resolve({}),
        providerMetadata: Promise.resolve(undefined),
      })

      setupUserConfig()
      const result = await dispatchExecution(USER_ID, 'scheduled', 'test', metadata, () => null)

      // Empty text returns empty string (not 'Done.' since '' ?? 'Done.' = '')
      expect(result).toBe('')
    })
  })

  describe('context mode with assistant messages', () => {
    const metadata: ExecutionMetadata = {
      mode: 'context',
      delivery_brief: 'Test',
      context_snapshot: null,
    }

    test('appends assistant response to history in context mode', async () => {
      streamTextImpl = (): StreamTextResult => ({
        text: Promise.resolve('Context response'),
        toolCalls: Promise.resolve([]),
        toolResults: Promise.resolve([]),
        response: Promise.resolve({
          messages: [
            { role: 'assistant' as const, content: 'Context response' },
            { role: 'assistant' as const, content: 'Follow up' },
          ],
        }),
        steps: Promise.resolve([]),
        usage: Promise.resolve({}),
        finishReason: Promise.resolve('stop'),
        warnings: Promise.resolve(undefined),
        request: Promise.resolve({}),
        providerMetadata: Promise.resolve(undefined),
      })

      setupUserConfig()
      const result = await dispatchExecution(USER_ID, 'scheduled', 'test', metadata, () => null)

      expect(result).toBe('Context response')
    })
  })

  describe('full mode with tool calls', () => {
    const metadata: ExecutionMetadata = {
      mode: 'full',
      delivery_brief: 'Test tool calls',
      context_snapshot: null,
    }

    test('handles tool results with toolCallId mapping', async () => {
      streamTextImpl = (): StreamTextResult => ({
        text: Promise.resolve('Task created successfully'),
        toolCalls: Promise.resolve([{ toolCallId: 'call-1', toolName: 'create_task', input: { title: 'Test task' } }]),
        toolResults: Promise.resolve([
          { toolCallId: 'call-1', output: { id: 'task-123', title: 'Test task', number: 42 } },
        ]),
        response: Promise.resolve({
          messages: [{ role: 'assistant' as const, content: 'Task created successfully' }],
        }),
        steps: Promise.resolve([]),
        usage: Promise.resolve({}),
        finishReason: Promise.resolve('stop'),
        warnings: Promise.resolve(undefined),
        request: Promise.resolve({}),
        providerMetadata: Promise.resolve(undefined),
      })

      setupUserConfig()
      const provider = createMockProvider()
      const result = await dispatchExecution(USER_ID, 'scheduled', 'create a task', metadata, () => provider)

      expect(result).toBe('Task created successfully')
      expect(streamTextCalls).toHaveLength(1)
    })

    test('handles multiple tool calls and results', async () => {
      streamTextImpl = (): StreamTextResult => ({
        text: Promise.resolve('Multiple tasks created'),
        toolCalls: Promise.resolve([
          { toolCallId: 'call-1', toolName: 'create_task', input: { title: 'Task 1' } },
          { toolCallId: 'call-2', toolName: 'create_task', input: { title: 'Task 2' } },
        ]),
        toolResults: Promise.resolve([
          { toolCallId: 'call-1', output: { id: 'task-1', title: 'Task 1', number: 1 } },
          { toolCallId: 'call-2', output: { id: 'task-2', title: 'Task 2', number: 2 } },
        ]),
        response: Promise.resolve({
          messages: [{ role: 'assistant' as const, content: 'Multiple tasks created' }],
        }),
        steps: Promise.resolve([]),
        usage: Promise.resolve({}),
        finishReason: Promise.resolve('stop'),
        warnings: Promise.resolve(undefined),
        request: Promise.resolve({}),
        providerMetadata: Promise.resolve(undefined),
      })

      setupUserConfig()
      const provider = createMockProvider()
      const result = await dispatchExecution(USER_ID, 'scheduled', 'create tasks', metadata, () => provider)

      expect(result).toBe('Multiple tasks created')
    })

    test('handles tool result without matching tool call', async () => {
      streamTextImpl = (): StreamTextResult => ({
        text: Promise.resolve('Done'),
        toolCalls: Promise.resolve([{ toolCallId: 'call-1', toolName: 'create_task', input: { title: 'Task 1' } }]),
        toolResults: Promise.resolve([
          { toolCallId: 'call-1', output: { id: 'task-1', title: 'Task 1', number: 1 } },
          { toolCallId: 'call-orphan', output: { id: 'task-2', title: 'Orphan task', number: 2 } },
        ]),
        response: Promise.resolve({
          messages: [{ role: 'assistant' as const, content: 'Done' }],
        }),
        steps: Promise.resolve([]),
        usage: Promise.resolve({}),
        finishReason: Promise.resolve('stop'),
        warnings: Promise.resolve(undefined),
        request: Promise.resolve({}),
        providerMetadata: Promise.resolve(undefined),
      })

      setupUserConfig()
      const provider = createMockProvider()
      const result = await dispatchExecution(USER_ID, 'scheduled', 'test', metadata, () => provider)

      expect(result).toBe('Done')
    })
  })
})
