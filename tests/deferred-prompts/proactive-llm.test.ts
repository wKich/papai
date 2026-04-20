// tests/deferred-prompts/execution-modes.test.ts
//
// Mocked modules: ai, @ai-sdk/openai-compatible, ../src/logger.js
// (Uses mockLogger + setupTestDb helpers; mocks ai + openai-compatible in beforeEach)
import { beforeEach, describe, expect, mock, test } from 'bun:test'

import type { ModelMessage } from 'ai'

import { setConfig } from '../../src/config.js'
import { dispatchExecution } from '../../src/deferred-prompts/proactive-llm.js'
import type { DeferredExecutionContext } from '../../src/deferred-prompts/proactive-llm.js'
import type { ExecutionMetadata } from '../../src/deferred-prompts/types.js'
import { appendHistory } from '../../src/history.js'
import { loadHistory } from '../../src/history.js'
import { loadFacts } from '../../src/memory.js'
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

function makeExecCtx(userId: string = USER_ID): DeferredExecutionContext {
  return {
    createdByUserId: userId,
    deliveryTarget: {
      contextId: userId,
      contextType: 'dm',
      threadId: null,
      audience: 'personal',
      mentionUserIds: [],
      createdByUserId: userId,
      createdByUsername: null,
    },
  }
}

function makeGroupThreadExecCtx(userId: string = USER_ID): DeferredExecutionContext {
  return {
    createdByUserId: userId,
    deliveryTarget: {
      contextId: '-1001',
      contextType: 'group',
      threadId: '42',
      audience: 'personal',
      mentionUserIds: [userId],
      createdByUserId: userId,
      createdByUsername: null,
    },
  }
}

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
      await dispatchExecution(makeExecCtx(), 'scheduled', 'drink water', metadata, () => null)
      expect(generateTextCalls).toHaveLength(1)
      expect(generateTextCalls[0]!.model).toContain('small-model')
    })

    test('falls back to main_model when small_model not set', async () => {
      setupUserConfig()
      await dispatchExecution(makeExecCtx(), 'scheduled', 'drink water', metadata, () => null)
      expect(generateTextCalls).toHaveLength(1)
      expect(generateTextCalls[0]!.model).toContain('main-model')
    })

    test('includes get_current_time tool only', async () => {
      setupUserConfig()
      await dispatchExecution(makeExecCtx(), 'scheduled', 'drink water', metadata, () => null)
      expect(generateTextCalls[0]!.tools).toBeDefined()
      expect(generateTextCalls[0]!.tools).toHaveProperty('get_current_time')
      // Should not have task-related tools in lightweight mode
      expect(generateTextCalls[0]!.tools).not.toHaveProperty('create_task')
    })

    test('uses minimal system prompt', async () => {
      setupUserConfig()
      await dispatchExecution(makeExecCtx(), 'scheduled', 'drink water', metadata, () => null)
      const system = generateTextCalls[0]!.system
      expect(system).toContain('[PROACTIVE EXECUTION]')
      expect(system).not.toContain('DEFERRED PROMPTS')
    })

    test('includes delivery brief in messages', async () => {
      setupUserConfig()
      await dispatchExecution(makeExecCtx(), 'scheduled', 'drink water', metadata, () => null)
      const messages = generateTextCalls[0]!.messages
      const systemMsgs = messages.filter((m) => m.role === 'system')
      expect(systemMsgs.some((m) => typeof m.content === 'string' && m.content.includes('[DELIVERY BRIEF]'))).toBe(true)
      expect(
        systemMsgs.some((m) => typeof m.content === 'string' && m.content.includes('Friendly hydration reminder')),
      ).toBe(true)
    })

    test('wraps prompt in deferred task delimiters', async () => {
      setupUserConfig()
      await dispatchExecution(makeExecCtx(), 'scheduled', 'drink water', metadata, () => null)
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
      await dispatchExecution(makeExecCtx(), 'scheduled', 'drink water', metadata, () => null)
      const messages = generateTextCalls[0]!.messages
      expect(messages.some((m) => typeof m.content === 'string' && m.content.includes('old message'))).toBe(false)
    })

    test('includes context snapshot when present', async () => {
      setupUserConfig()
      const withSnapshot: ExecutionMetadata = { ...metadata, context_snapshot: 'User discussed migration' }
      await dispatchExecution(makeExecCtx(), 'scheduled', 'remind about migration', withSnapshot, () => null)
      const messages = generateTextCalls[0]!.messages
      const systemMsgs = messages.filter((m) => m.role === 'system')
      expect(
        systemMsgs.some((m) => typeof m.content === 'string' && m.content.includes('[CONTEXT FROM CREATION TIME]')),
      ).toBe(true)
    })

    test('omits context snapshot message when null', async () => {
      setupUserConfig()
      await dispatchExecution(makeExecCtx(), 'scheduled', 'drink water', metadata, () => null)
      const messages = generateTextCalls[0]!.messages
      expect(
        messages.some((m) => typeof m.content === 'string' && m.content.includes('[CONTEXT FROM CREATION TIME]')),
      ).toBe(false)
    })

    test('persists lightweight history to group thread delivery context instead of creator DM', async () => {
      setupUserConfig()
      generateTextImpl = (args: GenerateTextCall): Promise<GenerateTextResult> => {
        generateTextCalls.push(args)
        return Promise.resolve({
          text: 'Thread reminder',
          toolCalls: [],
          toolResults: [],
          response: { messages: [{ role: 'assistant', content: 'Thread reminder' }] },
        })
      }

      await dispatchExecution(makeGroupThreadExecCtx(), 'scheduled', 'drink water', metadata, () => null)

      expect(loadHistory('-1001:42')).toEqual([{ role: 'assistant', content: 'Thread reminder' }])
      expect(loadHistory(USER_ID)).toEqual([])
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
      await dispatchExecution(makeExecCtx(), 'scheduled', 'standup reminder', metadata, () => null)
      expect(generateTextCalls[0]!.model).toContain('main-model')
    })

    test('loads conversation history', async () => {
      setupUserConfig()
      appendHistory(USER_ID, [{ role: 'user', content: 'history message' }])
      await dispatchExecution(makeExecCtx(), 'scheduled', 'standup reminder', metadata, () => null)
      const messages = generateTextCalls[0]!.messages
      expect(messages.some((m) => typeof m.content === 'string' && m.content.includes('history message'))).toBe(true)
    })

    test('includes get_current_time tool only', async () => {
      setupUserConfig()
      await dispatchExecution(makeExecCtx(), 'scheduled', 'standup reminder', metadata, () => null)
      expect(generateTextCalls[0]!.tools).toBeDefined()
      expect(generateTextCalls[0]!.tools).toHaveProperty('get_current_time')
      // Should not have task-related tools in context mode
      expect(generateTextCalls[0]!.tools).not.toHaveProperty('create_task')
    })

    test('uses minimal system prompt', async () => {
      setupUserConfig()
      await dispatchExecution(makeExecCtx(), 'scheduled', 'standup reminder', metadata, () => null)
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
      await dispatchExecution(makeExecCtx(), 'scheduled', 'check overdue', metadata, () => provider)
      expect(generateTextCalls[0]!.model).toContain('main-model')
    })

    test('includes tools with proactive mode', async () => {
      setupUserConfig()
      const provider = createMockProvider()
      await dispatchExecution(makeExecCtx(), 'scheduled', 'check overdue', metadata, () => provider)
      expect(generateTextCalls[0]!.tools).toBeDefined()
      // Full mode with proactive delivery should exclude deferred prompt tools
      expect(generateTextCalls[0]!.tools).not.toHaveProperty('create_deferred_prompt')
      expect(generateTextCalls[0]!.tools).toHaveProperty('create_task')
    })

    test('uses full system prompt', async () => {
      setupUserConfig()
      const provider = createMockProvider()
      await dispatchExecution(makeExecCtx(), 'scheduled', 'check overdue', metadata, () => provider)
      const system = generateTextCalls[0]!.system
      // Full system prompt includes provider-specific content
      expect(system.length).toBeGreaterThan(200)
    })

    test('loads conversation history', async () => {
      setupUserConfig()
      const provider = createMockProvider()
      appendHistory(USER_ID, [{ role: 'user', content: 'full mode history' }])
      await dispatchExecution(makeExecCtx(), 'scheduled', 'check overdue', metadata, () => provider)
      const messages = generateTextCalls[0]!.messages
      expect(messages.some((m) => typeof m.content === 'string' && m.content.includes('full mode history'))).toBe(true)
    })

    test('returns error when provider cannot be built', async () => {
      setupUserConfig()
      const result = await dispatchExecution(makeExecCtx(), 'scheduled', 'check overdue', metadata, () => null)
      expect(result).toContain('task provider not configured')
    })

    test('stores extracted facts in group thread delivery context instead of creator DM', async () => {
      setupUserConfig()
      const provider = createMockProvider()
      generateTextImpl = (args: GenerateTextCall): Promise<GenerateTextResult> => {
        generateTextCalls.push(args)
        return Promise.resolve({
          text: 'Created task',
          toolCalls: [],
          toolResults: [{ toolName: 'create_task', output: { id: 'task-1', title: 'Thread task', number: 17 } }],
          response: { messages: [] },
        })
      }

      await dispatchExecution(makeGroupThreadExecCtx(), 'scheduled', 'check overdue', metadata, () => provider)

      expect(loadFacts('-1001:42')).toEqual([
        expect.objectContaining({ identifier: '#17', title: 'Thread task', url: '' }),
      ])
      expect(loadFacts(USER_ID)).toEqual([])
    })
  })

  describe('fallback behavior', () => {
    test('treats empty metadata as full mode', async () => {
      setupUserConfig()
      const emptyMetadata: ExecutionMetadata = { mode: 'full', delivery_brief: '', context_snapshot: null }
      const provider = createMockProvider()
      await dispatchExecution(makeExecCtx(), 'scheduled', 'test', emptyMetadata, () => provider)
      expect(generateTextCalls[0]!.tools).toBeDefined()
    })
  })

  describe('stored delivery context', () => {
    const metadata: ExecutionMetadata = {
      mode: 'full',
      delivery_brief: 'Check overdue tasks grouped by project',
      context_snapshot: null,
    }

    test('full mode uses stored delivery context for tools and history while reading config from creator', async () => {
      setupUserConfig()
      const provider = createMockProvider()

      await dispatchExecution(
        {
          createdByUserId: USER_ID,
          deliveryTarget: {
            contextId: '-1001:42',
            contextType: 'group',
            threadId: '42',
            audience: 'personal',
            mentionUserIds: [USER_ID],
            createdByUserId: USER_ID,
            createdByUsername: null,
          },
        },
        'scheduled',
        'check overdue',
        metadata,
        () => provider,
      )

      expect(generateTextCalls).toHaveLength(1)
      expect(generateTextCalls[0]!.tools).toHaveProperty('create_task')
    })
  })
})
