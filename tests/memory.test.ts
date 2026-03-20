import { Database } from 'bun:sqlite'
import { mock, describe, expect, test, beforeEach } from 'bun:test'

import type { LanguageModel } from 'ai'
import { eq } from 'drizzle-orm'
import { drizzle } from 'drizzle-orm/bun-sqlite'

import * as schema from '../src/db/schema.js'
import { flushMicrotasks } from './test-helpers.js'

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

type GenerateTextResult = { output: { keep_indices: number[]; summary: string } }

let generateTextImpl = (): Promise<GenerateTextResult> =>
  Promise.resolve({ output: { keep_indices: [0, 1], summary: 'Updated summary text' } })

void mock.module('ai', () => ({
  generateText: (..._args: unknown[]): Promise<GenerateTextResult> => generateTextImpl(),
  Output: { object: ({ schema: s }: { schema: unknown }): { schema: unknown } => ({ schema: s }) },
}))

import {
  buildMemoryContextMessage,
  loadSummary,
  saveSummary,
  loadFacts,
  upsertFact,
  clearSummary,
  clearFacts,
  trimWithMemoryModel,
} from '../src/memory.js'
import { extractFacts } from './helpers/extract-facts.js'
import { clearUserCache } from './utils/test-cache.js'

describe('loadSummary', () => {
  beforeEach(() => {
    testSqlite = new Database(':memory:')
    testDb = drizzle(testSqlite, { schema })
    // Create memory_summary table
    testSqlite.run(`
      CREATE TABLE memory_summary (
        user_id TEXT PRIMARY KEY,
        summary TEXT NOT NULL,
        updated_at TEXT NOT NULL
      )
    `)
  })

  test('returns null when no row exists', () => {
    expect(loadSummary('999')).toBeNull()
  })

  test('returns summary string when row exists', () => {
    testDb
      .insert(schema.memorySummary)
      .values({ userId: '1', summary: 'Previous conversation summary', updatedAt: new Date().toISOString() })
      .run()
    expect(loadSummary('1')).toBe('Previous conversation summary')
  })
})

describe('saveSummary', () => {
  beforeEach(() => {
    testSqlite = new Database(':memory:')
    testDb = drizzle(testSqlite, { schema })
    // Create memory_summary table
    testSqlite.run(`
      CREATE TABLE memory_summary (
        user_id TEXT PRIMARY KEY,
        summary TEXT NOT NULL,
        updated_at TEXT NOT NULL
      )
    `)
  })

  test('persists summary', async () => {
    saveSummary('1', 'Test summary')
    await flushMicrotasks()
    const row = testDb.select().from(schema.memorySummary).where(eq(schema.memorySummary.userId, '1')).get()
    expect(row?.summary).toBe('Test summary')
  })

  test('calls INSERT OR REPLACE', async () => {
    saveSummary('1', 'Test')
    await flushMicrotasks()
    const row = testDb.select().from(schema.memorySummary).where(eq(schema.memorySummary.userId, '1')).get()
    expect(row).toBeDefined()
    expect(row!.userId).toBe('1')
  })
})

describe('clearSummary', () => {
  beforeEach(() => {
    testSqlite = new Database(':memory:')
    testDb = drizzle(testSqlite, { schema })
    // Create memory_summary table
    testSqlite.run(`
      CREATE TABLE memory_summary (
        user_id TEXT PRIMARY KEY,
        summary TEXT NOT NULL,
        updated_at TEXT NOT NULL
      )
    `)
  })

  test('removes summary', () => {
    testDb
      .insert(schema.memorySummary)
      .values({ userId: '1', summary: 'Summary', updatedAt: new Date().toISOString() })
      .run()
    clearSummary('1')
    const row = testDb.select().from(schema.memorySummary).where(eq(schema.memorySummary.userId, '1')).get()
    expect(row).toBeUndefined()
  })
})

describe('clearFacts', () => {
  beforeEach(() => {
    testSqlite = new Database(':memory:')
    testDb = drizzle(testSqlite, { schema })
    // Create memory_facts table
    testSqlite.run(`
      CREATE TABLE memory_facts (
        user_id TEXT NOT NULL,
        identifier TEXT NOT NULL,
        title TEXT NOT NULL,
        url TEXT NOT NULL DEFAULT '',
        last_seen TEXT NOT NULL,
        PRIMARY KEY (user_id, identifier)
      )
    `)
  })

  test('clears facts from database', () => {
    // Insert a fact first
    testDb
      .insert(schema.memoryFacts)
      .values({ userId: '1', identifier: '#42', title: 'Test', url: '', lastSeen: new Date().toISOString() })
      .run()
    clearFacts('1')
    const rows = testDb.select().from(schema.memoryFacts).where(eq(schema.memoryFacts.userId, '1')).all()
    expect(rows).toHaveLength(0)
  })
})

describe('buildMemoryContextMessage', () => {
  test('returns null when both summary and facts are empty', () => {
    expect(buildMemoryContextMessage(null, [])).toBeNull()
  })

  test('returns null for empty string summary and no facts', () => {
    expect(buildMemoryContextMessage('', [])).toBeNull()
  })

  test('returns system message with summary only', () => {
    const result = buildMemoryContextMessage('User created #42', [])
    expect(result).not.toBeNull()
    expect(result!.role).toBe('system')
    expect(result!.content).toContain('Summary: User created #42')
    expect(result!.content).toContain('=== Memory context ===')
  })

  test('returns system message with facts only', () => {
    const facts = [
      {
        identifier: '#42',
        title: 'Fix login',
        url: 'https://linear.app/#42',
        last_seen: '2026-03-01T00:00:00Z',
      },
    ]
    const result = buildMemoryContextMessage(null, facts)
    expect(result).not.toBeNull()
    expect(result!.content).toContain('#42')
    expect(result!.content).toContain('Fix login')
    expect(result!.content).toContain('Recently accessed Kaneo entities')
  })

  test('returns combined message with both summary and facts', () => {
    const facts = [{ identifier: '#42', title: 'Fix login', url: '', last_seen: '2026-03-01T00:00:00Z' }]
    const result = buildMemoryContextMessage('Previous summary', facts)
    expect(result).not.toBeNull()
    expect(result!.content).toContain('Summary: Previous summary')
    expect(result!.content).toContain('#42')
  })

  test('formats last_seen date as YYYY-MM-DD', () => {
    const facts = [{ identifier: '#1', title: 'Test', url: '', last_seen: '2026-03-05T14:30:00Z' }]
    const result = buildMemoryContextMessage(null, facts)
    expect(result!.content).toContain('last seen 2026-03-05')
  })
})

describe('extractFacts', () => {
  test('extracts fact from create_task result', () => {
    const results = [
      {
        toolName: 'create_task',
        result: { id: 'task-42', title: 'New task', number: 42 },
      },
    ]
    const facts = extractFacts(results)
    expect(facts).toHaveLength(1)
    expect(facts[0]!.identifier).toBe('#42')
    expect(facts[0]!.title).toBe('New task')
  })

  test('extracts fact from update_task result', () => {
    const results = [{ toolName: 'update_task', result: { id: 'task-38', number: 38 } }]
    const facts = extractFacts(results)
    expect(facts).toHaveLength(1)
    expect(facts[0]!.identifier).toBe('#38')
    // no title → falls back to identifier
    expect(facts[0]!.title).toBe('#38')
  })

  test('extracts fact from delete_task result', () => {
    const results = [{ toolName: 'delete_task', result: { id: 'task-10', number: 10 } }]
    const facts = extractFacts(results)
    expect(facts).toHaveLength(1)
    expect(facts[0]!.identifier).toBe('#10')
    expect(facts[0]!.title).toBe('#10')
  })

  test('extracts fact from update_project result', () => {
    const results = [{ toolName: 'update_project', result: { id: 'proj-99', name: 'Updated Name' } }]
    const facts = extractFacts(results)
    expect(facts).toHaveLength(1)
    expect(facts[0]!.identifier).toBe('proj:proj-99')
    expect(facts[0]!.title).toBe('Updated Name')
  })

  test('does not extract fact from get_task result', () => {
    const results = [{ toolName: 'get_task', result: { id: 'task-10', title: 'Details', number: 10 } }]
    const facts = extractFacts(results)
    expect(facts).toHaveLength(0)
  })

  test('does not extract facts from search_tasks result', () => {
    const items = [
      { id: 'task-1', title: 'A', number: 1 },
      { id: 'task-2', title: 'B', number: 2 },
    ]
    const results = [{ toolName: 'search_tasks', result: items }]
    const facts = extractFacts(results)
    expect(facts).toHaveLength(0)
  })

  test('returns empty array for unknown tool', () => {
    const results = [{ toolName: 'unknown_tool', result: { id: 'X' } }]
    const facts = extractFacts(results)
    expect(facts).toEqual([])
  })

  test('returns empty array for malformed result', () => {
    const results = [{ toolName: 'create_task', result: { no_id: true } }]
    const facts = extractFacts(results)
    expect(facts).toEqual([])
  })

  test('extracts fact from create_project result', () => {
    const results = [
      {
        toolName: 'create_project',
        result: { id: 'proj-123', name: 'Backend Migration', url: 'https://kaneo.app/project/proj-123' },
      },
    ]
    const facts = extractFacts(results)
    expect(facts).toHaveLength(1)
    expect(facts[0]!.identifier).toBe('proj:proj-123')
    expect(facts[0]!.title).toBe('Backend Migration')
    expect(facts[0]!.url).toBe('https://kaneo.app/project/proj-123')
  })

  test('extracts create_project fact without url', () => {
    const results = [{ toolName: 'create_project', result: { id: 'proj-456', name: 'Frontend Refactor' } }]
    const facts = extractFacts(results)
    expect(facts).toHaveLength(1)
    expect(facts[0]!.identifier).toBe('proj:proj-456')
    expect(facts[0]!.title).toBe('Frontend Refactor')
    expect(facts[0]!.url).toBe('')
  })

  test('ignores malformed create_project result', () => {
    const results = [{ toolName: 'create_project', result: { no_id: true, name: 'Test' } }]
    const facts = extractFacts(results)
    expect(facts).toEqual([])
  })
})

describe('upsertFact eviction', () => {
  beforeEach(async () => {
    testSqlite = new Database(':memory:')
    testDb = drizzle(testSqlite, { schema })
    // Create memory_facts table
    testSqlite.run(`
      CREATE TABLE memory_facts (
        user_id TEXT NOT NULL,
        identifier TEXT NOT NULL,
        title TEXT NOT NULL,
        url TEXT NOT NULL DEFAULT '',
        last_seen TEXT NOT NULL,
        PRIMARY KEY (user_id, identifier)
      )
    `)
    // Create memory_summary table (for cache lookups)
    testSqlite.run(`
      CREATE TABLE memory_summary (
        user_id TEXT PRIMARY KEY,
        summary TEXT NOT NULL,
        updated_at TEXT NOT NULL
      )
    `)
    clearUserCache('999')
    await flushMicrotasks()
  })

  test('evicts oldest facts when exceeding FACTS_CAP', async () => {
    const userId = '999'
    // Insert 52 facts (over the 50 cap)
    for (let i = 0; i < 52; i++) {
      upsertFact(userId, {
        identifier: `#${i}`,
        title: `Task ${i}`,
        url: `https://kaneo.app/task/${i}`,
      })
    }
    await flushMicrotasks()

    const facts = loadFacts(userId)
    // Should be capped at 50 (FACTS_CAP)
    expect(facts).toHaveLength(50)
    // Verify the facts are returned sorted by last_seen DESC
    for (let i = 1; i < facts.length; i++) {
      expect(facts[i]!.last_seen <= facts[i - 1]!.last_seen).toBe(true)
    }

    // Cleanup
    clearFacts(userId)
    clearUserCache(userId)
    await flushMicrotasks()
  })

  test('updates last_seen on duplicate fact insert', async () => {
    const userId = '999'
    const fact = { identifier: '#100', title: 'Test Task', url: '' }

    upsertFact(userId, fact)
    await flushMicrotasks()
    const firstLoad = loadFacts(userId)
    const firstSeen = firstLoad[0]!.last_seen

    // Small delay to ensure different timestamp
    await Bun.sleep(10)

    upsertFact(userId, fact)
    await flushMicrotasks()
    const secondLoad = loadFacts(userId)
    const secondSeen = secondLoad[0]!.last_seen

    expect(secondSeen).not.toBe(firstSeen)
    expect(secondLoad).toHaveLength(1)

    // Cleanup
    clearFacts(userId)
    clearUserCache(userId)
    await flushMicrotasks()
  })
})

describe('trimWithMemoryModel', () => {
  const mockModel: LanguageModel = 'test-model'

  const makeMessages = (count: number): Array<{ role: 'user' | 'assistant'; content: string }> =>
    Array.from({ length: count }, (_, i) => ({
      role: i % 2 === 0 ? ('user' as const) : ('assistant' as const),
      content: `Message ${i}`,
    }))

  test('returns trimmed messages and summary', async () => {
    const history = makeMessages(5)
    generateTextImpl = (): Promise<GenerateTextResult> =>
      Promise.resolve({ output: { keep_indices: [0, 2, 4], summary: 'Test summary' } })

    const result = await trimWithMemoryModel(history, 2, 10, null, mockModel)

    expect(result.trimmedMessages).toHaveLength(3)
    expect(result.trimmedMessages[0]).toEqual(history[0])
    expect(result.trimmedMessages[1]).toEqual(history[2])
    expect(result.trimmedMessages[2]).toEqual(history[4])
    expect(result.summary).toBe('Test summary')
  })

  test('filters out-of-range indices', async () => {
    const history = makeMessages(3)
    generateTextImpl = (): Promise<GenerateTextResult> =>
      Promise.resolve({ output: { keep_indices: [0, 1, 99], summary: 'Summary' } })

    const result = await trimWithMemoryModel(history, 1, 10, null, mockModel)

    // 99 is out of range — filtered out
    expect(result.trimmedMessages).toHaveLength(2)
  })

  test('deduplicates indices', async () => {
    const history = makeMessages(5)
    generateTextImpl = (): Promise<GenerateTextResult> =>
      Promise.resolve({ output: { keep_indices: [1, 1, 2], summary: 'Summary' } })

    const result = await trimWithMemoryModel(history, 1, 10, null, mockModel)

    expect(result.trimmedMessages).toHaveLength(2)
    expect(result.trimmedMessages[0]).toEqual(history[1])
    expect(result.trimmedMessages[1]).toEqual(history[2])
  })

  test('pads to trimMin when model returns too few indices', async () => {
    const history = makeMessages(10)
    generateTextImpl = (): Promise<GenerateTextResult> =>
      Promise.resolve({ output: { keep_indices: [0, 1], summary: 'Summary' } })

    const result = await trimWithMemoryModel(history, 5, 10, null, mockModel)

    expect(result.trimmedMessages.length).toBeGreaterThanOrEqual(5)
  })

  test('caps at trimMax when model returns too many indices', async () => {
    const history = makeMessages(10)
    generateTextImpl = (): Promise<GenerateTextResult> =>
      Promise.resolve({ output: { keep_indices: [0, 1, 2, 3, 4, 5, 6, 7, 8, 9], summary: 'Summary' } })

    const result = await trimWithMemoryModel(history, 1, 3, null, mockModel)

    expect(result.trimmedMessages).toHaveLength(3)
  })
})
