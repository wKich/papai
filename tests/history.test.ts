import { Database } from 'bun:sqlite'
import { mock, describe, expect, test, beforeEach } from 'bun:test'

import { eq } from 'drizzle-orm'
import { drizzle } from 'drizzle-orm/bun-sqlite'

import * as schema from '../src/db/schema.js'

// --- Test database setup with Drizzle ---
let testDb: ReturnType<typeof drizzle<typeof schema>>
let testSqlite: Database

// Mock getDrizzleDb to return our test database
void mock.module('../src/db/drizzle.js', () => ({
  getDrizzleDb: (): ReturnType<typeof drizzle<typeof schema>> => testDb,
}))

// Mock db/index.js to return test sqlite instance for cache.ts
void mock.module('../src/db/index.js', () => ({
  getDb: (): Database => testSqlite,
  DB_PATH: ':memory:',
  initDb: (): void => {},
}))

import type { ModelMessage } from 'ai'

import { loadHistory, saveHistory, clearHistory } from '../src/history.js'
import { flushMicrotasks } from './test-helpers.js'

describe('loadHistory', () => {
  beforeEach(() => {
    testSqlite = new Database(':memory:')
    testDb = drizzle(testSqlite, { schema })
    // Create conversation_history table
    testSqlite.run(`
      CREATE TABLE conversation_history (
        user_id TEXT PRIMARY KEY,
        messages TEXT NOT NULL
      )
    `)
  })

  test('returns empty array when no row exists', () => {
    const result = loadHistory('999')
    expect(result).toEqual([])
  })

  test('returns deserialised messages for valid row', () => {
    const messages = [
      { role: 'user', content: 'hello' },
      { role: 'assistant', content: 'hi there' },
    ]
    testDb
      .insert(schema.conversationHistory)
      .values({ userId: '1', messages: JSON.stringify(messages) })
      .run()

    const result = loadHistory('1')
    expect(result).toHaveLength(2)
    expect(result[0]).toEqual({ role: 'user', content: 'hello' })
    expect(result[1]).toEqual({ role: 'assistant', content: 'hi there' })
  })

  test('returns empty array for corrupt JSON', () => {
    testDb.insert(schema.conversationHistory).values({ userId: '2', messages: 'not-valid-json' }).run()

    const result = loadHistory('2')
    expect(result).toEqual([])
  })

  test('returns empty array when messages lack role field', () => {
    testDb
      .insert(schema.conversationHistory)
      .values({ userId: '3', messages: JSON.stringify([{ content: 'no role' }]) })
      .run()

    const result = loadHistory('3')
    expect(result).toEqual([])
  })

  test('strips unknown fields not in ModelMessage schema', () => {
    // modelMessageSchema uses Zod which strips unrecognised properties — unknown
    // keys like `toolCalls` (not part of AssistantModelMessage in SDK v6) are dropped.
    const messages = [{ role: 'assistant', content: 'hi', unknownField: 'value' }]
    testDb
      .insert(schema.conversationHistory)
      .values({ userId: '4', messages: JSON.stringify(messages) })
      .run()

    const result = loadHistory('4')
    expect(result).toHaveLength(1)
    const first = result[0]
    expect(first).toBeDefined()
    expect(first?.content).toBe('hi')
  })

  test('returns messages when content is an array (tool call / tool result messages)', () => {
    // The Vercel AI SDK uses array content for tool calls and tool results.
    // Regression: the previous custom validator required content to be a string,
    // causing the entire history to be dropped after cache eviction whenever
    // tool-calling had occurred in the conversation.
    const messages = [
      { role: 'user', content: 'what tasks do I have?' },
      {
        role: 'assistant',
        content: [{ type: 'tool-call', toolCallId: 'tc1', toolName: 'list_tasks', args: {} }],
      },
      {
        role: 'tool',
        content: [
          {
            type: 'tool-result',
            toolCallId: 'tc1',
            toolName: 'list_tasks',
            output: { type: 'json', value: [] },
          },
        ],
      },
      { role: 'assistant', content: 'You have no tasks.' },
    ]
    testDb
      .insert(schema.conversationHistory)
      .values({ userId: '5', messages: JSON.stringify(messages) })
      .run()

    const result = loadHistory('5')
    expect(result).toHaveLength(4)

    // Verify assistant message has tool-call content
    const assistantMsg = result[1]
    expect(assistantMsg).toBeDefined()
    const assistantContent = assistantMsg?.content
    expect(Array.isArray(assistantContent)).toBe(true)
    expect(assistantContent).toHaveLength(1)
    // Verify structure of first item in array content
    const firstAssistantItem = Array.isArray(assistantContent) ? assistantContent[0] : undefined
    expect(firstAssistantItem).toMatchObject({ type: 'tool-call', toolCallId: 'tc1', toolName: 'list_tasks' })

    // Verify tool message has tool-result content
    const toolMsg = result[2]
    expect(toolMsg).toBeDefined()
    const toolContent = toolMsg?.content
    expect(Array.isArray(toolContent)).toBe(true)
    expect(toolContent).toHaveLength(1)
    // Verify structure of first item in array content
    const firstToolItem = Array.isArray(toolContent) ? toolContent[0] : undefined
    expect(firstToolItem).toMatchObject({ type: 'tool-result', toolCallId: 'tc1', toolName: 'list_tasks' })
  })

  test('rejects messages where content is neither string nor array', () => {
    const messages = [{ role: 'user', content: 42 }]
    testDb
      .insert(schema.conversationHistory)
      .values({ userId: '6', messages: JSON.stringify(messages) })
      .run()

    const result = loadHistory('6')
    expect(result).toEqual([])
  })
})

describe('saveHistory', () => {
  beforeEach(() => {
    testSqlite = new Database(':memory:')
    testDb = drizzle(testSqlite, { schema })
    // Create conversation_history table
    testSqlite.run(`
      CREATE TABLE conversation_history (
        user_id TEXT PRIMARY KEY,
        messages TEXT NOT NULL
      )
    `)
  })

  test('persists messages as JSON', async () => {
    const messages: ModelMessage[] = [{ role: 'user', content: 'test' }]
    saveHistory('10', messages)

    // Wait for background DB sync
    await flushMicrotasks()

    const row = testDb
      .select()
      .from(schema.conversationHistory)
      .where(eq(schema.conversationHistory.userId, '10'))
      .get()
    expect(row).toBeDefined()
    expect(JSON.parse(row!.messages)).toEqual(messages)
  })

  test('calls INSERT OR REPLACE', async () => {
    const empty: ModelMessage[] = []
    saveHistory('10', empty)

    // Wait for background DB sync
    await flushMicrotasks()

    const row = testDb
      .select()
      .from(schema.conversationHistory)
      .where(eq(schema.conversationHistory.userId, '10'))
      .get()
    expect(row).toBeDefined()
    expect(row!.userId).toBe('10')
  })
})

describe('clearHistory', () => {
  beforeEach(() => {
    testSqlite = new Database(':memory:')
    testDb = drizzle(testSqlite, { schema })
    // Create conversation_history table
    testSqlite.run(`
      CREATE TABLE conversation_history (
        user_id TEXT PRIMARY KEY,
        messages TEXT NOT NULL
      )
    `)
  })

  test('removes entry from store', () => {
    testDb
      .insert(schema.conversationHistory)
      .values({ userId: '20', messages: JSON.stringify([]) })
      .run()
    clearHistory('20')
    const row = testDb
      .select()
      .from(schema.conversationHistory)
      .where(eq(schema.conversationHistory.userId, '20'))
      .get()
    expect(row).toBeUndefined()
  })

  test('calls DELETE statement', () => {
    clearHistory('20')
    const row = testDb
      .select()
      .from(schema.conversationHistory)
      .where(eq(schema.conversationHistory.userId, '20'))
      .get()
    expect(row).toBeUndefined()
  })
})
