import { mock, afterAll, beforeEach, describe, expect, test } from 'bun:test'

import type { ModelMessage } from 'ai'

import { mockLogger, mockDrizzle, setupTestDb } from '../utils/test-helpers.js'

// Setup mocks BEFORE importing code under test
mockLogger()
mockDrizzle()

// Mock AI module using mutable implementation pattern
type GenerateTextResult = {
  text: string
  toolCalls: unknown[]
  toolResults: unknown[]
  response: { messages: ModelMessage[] }
}
let generateTextImpl = (): Promise<GenerateTextResult> =>
  Promise.resolve({ text: 'Done.', toolCalls: [], toolResults: [], response: { messages: [] } })

void mock.module('ai', () => ({
  generateText: (..._args: unknown[]): Promise<GenerateTextResult> => generateTextImpl(),
  tool: (opts: unknown): unknown => opts,
  stepCountIs: (_n: number): unknown => undefined,
}))

// Mock @ai-sdk/openai-compatible
void mock.module('@ai-sdk/openai-compatible', () => ({
  createOpenAICompatible: (): (() => string) => (): string => 'mock-model',
}))

import { eq } from 'drizzle-orm'

import type { ChatProvider } from '../../src/chat/types.js'
import { setConfig } from '../../src/config.js'
import * as schema from '../../src/db/schema.js'
import { createAlertPrompt } from '../../src/deferred-prompts/alerts.js'
import { pollAlertsOnce, pollScheduledOnce } from '../../src/deferred-prompts/poller.js'
import { createScheduledPrompt, getScheduledPrompt } from '../../src/deferred-prompts/scheduled.js'
import type { TaskProvider } from '../../src/providers/types.js'
import { createMockProvider } from '../tools/mock-provider.js'

afterAll(() => {
  mock.restore()
})

// --- Helpers ---

function createMockChat(): ChatProvider & { sentMessages: Array<{ userId: string; text: string }> } {
  const sentMessages: Array<{ userId: string; text: string }> = []
  return {
    name: 'mock',
    sentMessages,
    registerCommand: (): void => {},
    onMessage: (): void => {},
    sendMessage: (userId: string, text: string): Promise<void> => {
      sentMessages.push({ userId, text })
      return Promise.resolve()
    },
    start: (): Promise<void> => Promise.resolve(),
    stop: (): Promise<void> => Promise.resolve(),
  }
}

function setupUserConfig(userId: string): void {
  setConfig(userId, 'llm_apikey', 'test-key')
  setConfig(userId, 'llm_baseurl', 'http://localhost:11434/v1')
  setConfig(userId, 'main_model', 'test-model')
  setConfig(userId, 'timezone', 'UTC')
}

const USER_ID = 'poller-user-1'

// --- Tests ---

describe('pollScheduledOnce', () => {
  let chat: ReturnType<typeof createMockChat>
  let provider: TaskProvider

  beforeEach(async () => {
    await setupTestDb()
    chat = createMockChat()
    provider = createMockProvider()
    setupUserConfig(USER_ID)
    generateTextImpl = (): Promise<GenerateTextResult> =>
      Promise.resolve({ text: 'Task completed.', toolCalls: [], toolResults: [], response: { messages: [] } })
  })

  test('executes a due one-shot prompt, marks completed, sends message', async () => {
    const pastTime = new Date(Date.now() - 60_000).toISOString()
    const created = createScheduledPrompt(USER_ID, 'Check my overdue tasks', { fireAt: pastTime })

    await pollScheduledOnce(chat, () => provider)

    // Should have sent a message
    expect(chat.sentMessages).toHaveLength(1)
    expect(chat.sentMessages[0]!.userId).toBe(USER_ID)
    expect(chat.sentMessages[0]!.text).toBe('Task completed.')

    // Should be marked as completed
    const updated = getScheduledPrompt(created.id, USER_ID)
    expect(updated).not.toBeNull()
    expect(updated!.status).toBe('completed')
    expect(updated!.lastExecutedAt).not.toBeNull()
  })

  test('does not execute future prompts', async () => {
    const futureTime = new Date(Date.now() + 3_600_000).toISOString()
    createScheduledPrompt(USER_ID, 'Future task', { fireAt: futureTime })

    await pollScheduledOnce(chat, () => provider)

    expect(chat.sentMessages).toHaveLength(0)
  })

  test('advances recurring prompt to next cron occurrence', async () => {
    const pastTime = new Date(Date.now() - 60_000).toISOString()
    const created = createScheduledPrompt(USER_ID, 'Daily standup', {
      fireAt: pastTime,
      cronExpression: '0 9 * * *',
    })

    await pollScheduledOnce(chat, () => provider)

    // Should have sent a message
    expect(chat.sentMessages).toHaveLength(1)

    // Should still be active with updated fireAt
    const updated = getScheduledPrompt(created.id, USER_ID)
    expect(updated).not.toBeNull()
    expect(updated!.status).toBe('active')
    expect(updated!.lastExecutedAt).not.toBeNull()
    // fireAt should be in the future (next occurrence)
    expect(new Date(updated!.fireAt).getTime()).toBeGreaterThan(Date.now())
  })

  test('skips prompt when LLM config is missing', async () => {
    // Create a user without LLM config
    const unconfiguredUser = 'unconfigured-user'
    const pastTime = new Date(Date.now() - 60_000).toISOString()
    createScheduledPrompt(unconfiguredUser, 'No config', { fireAt: pastTime })

    await pollScheduledOnce(chat, () => provider)

    // Should still send the fallback message
    expect(chat.sentMessages).toHaveLength(1)
    expect(chat.sentMessages[0]!.text).toContain('missing LLM configuration')
  })
})

describe('pollScheduledOnce — background events', () => {
  let chat: ReturnType<typeof createMockChat>
  let provider: TaskProvider

  beforeEach(async () => {
    await setupTestDb()
    chat = createMockChat()
    provider = createMockProvider()
    setupUserConfig(USER_ID)
    generateTextImpl = (): Promise<GenerateTextResult> =>
      Promise.resolve({ text: 'Task completed.', toolCalls: [], toolResults: [], response: { messages: [] } })
  })

  test('records event on successful scheduled prompt execution', async () => {
    const db = await setupTestDb()
    setupUserConfig(USER_ID)
    const pastTime = new Date(Date.now() - 60_000).toISOString()
    createScheduledPrompt(USER_ID, 'create report task', { fireAt: pastTime })

    await pollScheduledOnce(chat, () => provider)

    const rows = db.select().from(schema.backgroundEvents).where(eq(schema.backgroundEvents.userId, USER_ID)).all()
    expect(rows).toHaveLength(1)
    expect(rows[0]!.type).toBe('scheduled')
    expect(rows[0]!.injectedAt).toBeNull()
  })

  test('records failure event and notifies user when LLM throws', async () => {
    generateTextImpl = (): Promise<GenerateTextResult> => Promise.reject(new Error('LLM down'))
    const db = await setupTestDb()
    const userId = 'fail-user'
    setupUserConfig(userId)
    const pastTime = new Date(Date.now() - 60_000).toISOString()
    createScheduledPrompt(userId, 'do something', { fireAt: pastTime })

    await pollScheduledOnce(chat, () => provider)

    const rows = db.select().from(schema.backgroundEvents).where(eq(schema.backgroundEvents.userId, userId)).all()
    expect(rows).toHaveLength(1)
    expect(rows[0]!.response).toMatch(/Failed/)
    expect(chat.sentMessages.some((m) => m.userId === userId)).toBe(true)
  })
})

describe('pollAlertsOnce', () => {
  let chat: ReturnType<typeof createMockChat>

  beforeEach(async () => {
    await setupTestDb()
    chat = createMockChat()
    setupUserConfig(USER_ID)
    generateTextImpl = (): Promise<GenerateTextResult> =>
      Promise.resolve({ text: 'Alert triggered.', toolCalls: [], toolResults: [], response: { messages: [] } })
  })

  test('does not trigger when no alerts exist', async () => {
    const provider = createMockProvider()

    await pollAlertsOnce(chat, () => provider)

    expect(chat.sentMessages).toHaveLength(0)
  })

  test('does not trigger when no tasks match condition', async () => {
    createAlertPrompt(USER_ID, 'Notify on done', { field: 'task.status', op: 'eq', value: 'done' })

    const provider = createMockProvider({
      listProjects: mock(() => Promise.resolve([{ id: 'proj-1', name: 'Test', url: 'http://test/proj/1' }])),
      listTasks: mock(() =>
        Promise.resolve([{ id: 'task-1', title: 'Test', status: 'in-progress', url: 'http://test/1' }]),
      ),
    })

    await pollAlertsOnce(chat, () => provider)

    expect(chat.sentMessages).toHaveLength(0)
  })

  test('triggers alert when task matches condition', async () => {
    createAlertPrompt(USER_ID, 'Notify on done', { field: 'task.status', op: 'eq', value: 'done' })

    const provider = createMockProvider({
      listProjects: mock(() => Promise.resolve([{ id: 'proj-1', name: 'Test', url: 'http://test/proj/1' }])),
      listTasks: mock(() =>
        Promise.resolve([{ id: 'task-1', title: 'Completed Task', status: 'done', url: 'http://test/1' }]),
      ),
    })

    await pollAlertsOnce(chat, () => provider)

    expect(chat.sentMessages).toHaveLength(1)
    expect(chat.sentMessages[0]!.userId).toBe(USER_ID)
    expect(chat.sentMessages[0]!.text).toBe('Alert triggered.')
  })

  test('enriches tasks via getTask when condition references assignee', async () => {
    createAlertPrompt(USER_ID, 'Notify on alice assignment', {
      field: 'task.assignee',
      op: 'eq',
      value: 'alice',
    })

    const provider = createMockProvider({
      listProjects: mock(() => Promise.resolve([{ id: 'proj-1', name: 'Test', url: 'http://test/proj/1' }])),
      listTasks: mock(() =>
        Promise.resolve([{ id: 'task-1', title: 'Assigned Task', status: 'todo', url: 'http://test/1' }]),
      ),
      getTask: mock(() =>
        Promise.resolve({
          id: 'task-1',
          title: 'Assigned Task',
          status: 'todo',
          assignee: 'alice',
          url: 'http://test/1',
        }),
      ),
    })

    await pollAlertsOnce(chat, () => provider)

    expect(chat.sentMessages).toHaveLength(1)
    expect(chat.sentMessages[0]!.text).toBe('Alert triggered.')
  })
})
