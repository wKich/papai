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

// Track generateText calls
type GenerateTextResult = {
  text: string
  toolCalls: unknown[]
  toolResults: unknown[]
  response: { messages: ModelMessage[] }
}
type GenerateTextCall = { model: string; system: string; messages: ModelMessage[]; tools: unknown }

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
  const generateTextCalls: GenerateTextCall[] = []

  let generateTextImpl = (args: GenerateTextCall): Promise<GenerateTextResult> => {
    generateTextCalls.push(args)
    return Promise.resolve({ text: 'Mock response', toolCalls: [], toolResults: [], response: { messages: [] } })
  }

  beforeEach(async () => {
    mockLogger()
    generateTextCalls.length = 0
    generateTextImpl = (args: GenerateTextCall): Promise<GenerateTextResult> => {
      generateTextCalls.push(args)
      return Promise.resolve({ text: 'Mock response', toolCalls: [], toolResults: [], response: { messages: [] } })
    }
    void mock.module('ai', () => ({
      generateText: (args: GenerateTextCall): Promise<GenerateTextResult> => generateTextImpl(args),
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
      expect(generateTextCalls).toHaveLength(1)
      expect(generateTextCalls[0]!.model).toContain('small-model')
    })

    test('falls back to main_model when small_model not set', async () => {
      setupUserConfig()
      await dispatchExecution(USER_ID, 'scheduled', 'drink water', metadata, () => null)
      expect(generateTextCalls).toHaveLength(1)
      expect(generateTextCalls[0]!.model).toContain('main-model')
    })

    test('includes get_current_time tool only', async () => {
      setupUserConfig()
      await dispatchExecution(USER_ID, 'scheduled', 'drink water', metadata, () => null)
      expect(generateTextCalls[0]!.tools).toBeDefined()
      expect(generateTextCalls[0]!.tools).toHaveProperty('get_current_time')
      // Should not have task-related tools in lightweight mode
      expect(generateTextCalls[0]!.tools).not.toHaveProperty('create_task')
    })

    test('uses minimal system prompt', async () => {
      setupUserConfig()
      await dispatchExecution(USER_ID, 'scheduled', 'drink water', metadata, () => null)
      const system = generateTextCalls[0]!.system
      expect(system).toContain('[PROACTIVE EXECUTION]')
      expect(system).not.toContain('DEFERRED PROMPTS')
    })

    test('includes delivery brief in messages', async () => {
      setupUserConfig()
      await dispatchExecution(USER_ID, 'scheduled', 'drink water', metadata, () => null)
      const messages = generateTextCalls[0]!.messages
      const systemMsgs = messages.filter((m) => m.role === 'system')
      expect(systemMsgs.some((m) => typeof m.content === 'string' && m.content.includes('[DELIVERY BRIEF]'))).toBe(true)
      expect(
        systemMsgs.some((m) => typeof m.content === 'string' && m.content.includes('Friendly hydration reminder')),
      ).toBe(true)
    })

    test('wraps prompt in deferred task delimiters', async () => {
      setupUserConfig()
      await dispatchExecution(USER_ID, 'scheduled', 'drink water', metadata, () => null)
      const messages = generateTextCalls[0]!.messages
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
      const messages = generateTextCalls[0]!.messages
      expect(messages.some((m) => typeof m.content === 'string' && m.content.includes('old message'))).toBe(false)
    })

    test('includes context snapshot when present', async () => {
      setupUserConfig()
      const withSnapshot: ExecutionMetadata = { ...metadata, context_snapshot: 'User discussed migration' }
      await dispatchExecution(USER_ID, 'scheduled', 'remind about migration', withSnapshot, () => null)
      const messages = generateTextCalls[0]!.messages
      const systemMsgs = messages.filter((m) => m.role === 'system')
      expect(
        systemMsgs.some((m) => typeof m.content === 'string' && m.content.includes('[CONTEXT FROM CREATION TIME]')),
      ).toBe(true)
    })

    test('omits context snapshot message when null', async () => {
      setupUserConfig()
      await dispatchExecution(USER_ID, 'scheduled', 'drink water', metadata, () => null)
      const messages = generateTextCalls[0]!.messages
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
      expect(generateTextCalls[0]!.model).toContain('main-model')
    })

    test('loads conversation history', async () => {
      setupUserConfig()
      appendHistory(USER_ID, [{ role: 'user', content: 'history message' }])
      await dispatchExecution(USER_ID, 'scheduled', 'standup reminder', metadata, () => null)
      const messages = generateTextCalls[0]!.messages
      expect(messages.some((m) => typeof m.content === 'string' && m.content.includes('history message'))).toBe(true)
    })

    test('includes get_current_time tool only', async () => {
      setupUserConfig()
      await dispatchExecution(USER_ID, 'scheduled', 'standup reminder', metadata, () => null)
      expect(generateTextCalls[0]!.tools).toBeDefined()
      expect(generateTextCalls[0]!.tools).toHaveProperty('get_current_time')
      // Should not have task-related tools in context mode
      expect(generateTextCalls[0]!.tools).not.toHaveProperty('create_task')
    })

    test('uses minimal system prompt', async () => {
      setupUserConfig()
      await dispatchExecution(USER_ID, 'scheduled', 'standup reminder', metadata, () => null)
      const system = generateTextCalls[0]!.system
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
      expect(generateTextCalls[0]!.model).toContain('main-model')
    })

    test('includes tools', async () => {
      setupUserConfig()
      const provider = createMockProvider()
      await dispatchExecution(USER_ID, 'scheduled', 'check overdue', metadata, () => provider)
      expect(generateTextCalls[0]!.tools).toBeDefined()
    })

    test('uses full system prompt', async () => {
      setupUserConfig()
      const provider = createMockProvider()
      await dispatchExecution(USER_ID, 'scheduled', 'check overdue', metadata, () => provider)
      const system = generateTextCalls[0]!.system
      // Full system prompt includes provider-specific content
      expect(system.length).toBeGreaterThan(200)
    })

    test('loads conversation history', async () => {
      setupUserConfig()
      const provider = createMockProvider()
      appendHistory(USER_ID, [{ role: 'user', content: 'full mode history' }])
      await dispatchExecution(USER_ID, 'scheduled', 'check overdue', metadata, () => provider)
      const messages = generateTextCalls[0]!.messages
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
      expect(generateTextCalls[0]!.tools).toBeDefined()
    })
  })
})
