import { mock, describe, expect, test, beforeEach } from 'bun:test'

// --- bun:sqlite mock (must come before importing memory.ts) ---
const mockSummaryStore = new Map<number, string>()
const mockFactsStore = new Map<string, Array<{ identifier: string; title: string; url: string; last_seen: string }>>()
const runCalls: Array<{ sql: string; params?: unknown[] }> = []

class MockDatabase {
  run(sql: string, params?: unknown[]): void {
    runCalls.push({ sql, params })
    if (sql.includes('INSERT OR REPLACE INTO memory_summary') && params !== undefined) {
      mockSummaryStore.set(Number(params[0]), String(params[1]))
    }
    if (sql.includes('DELETE FROM memory_summary') && params !== undefined) {
      mockSummaryStore.delete(Number(params[0]))
    }
    if (sql.includes('DELETE FROM memory_facts') && !sql.includes('NOT IN') && params !== undefined) {
      mockFactsStore.delete(String(params[0]))
    }
  }

  query(sql: string): {
    get: (userId: number) => { summary: string } | null
    all: (userId?: number) => unknown[]
  } {
    if (sql.includes('SELECT summary FROM memory_summary')) {
      return {
        get: (userId: number): { summary: string } | null => {
          const s = mockSummaryStore.get(userId)
          if (s === undefined) return null
          return { summary: s }
        },
        all: (): unknown[] => [],
      }
    }
    if (sql.includes('SELECT identifier, title')) {
      return {
        get: (): null => null,
        all: (userId?: number): unknown[] => {
          if (userId === undefined) return []
          return mockFactsStore.get(String(userId)) ?? []
        },
      }
    }
    return { get: (): null => null, all: (): unknown[] => [] }
  }
}

const mockDb = new MockDatabase()

void mock.module('../src/db/index.js', () => ({
  getDb: (): MockDatabase => mockDb,
  DB_PATH: ':memory:',
  initDb: (): void => {},
}))

type GenerateObjectResult = { object: { keep_indices: number[]; summary: string } }

let generateObjectImpl = (): Promise<GenerateObjectResult> =>
  Promise.resolve({ object: { keep_indices: [0, 1], summary: 'Updated summary text' } })

void mock.module('ai', () => ({
  generateObject: (..._args: unknown[]): Promise<GenerateObjectResult> => generateObjectImpl(),
}))
// --- end mocks ---

import {
  buildMemoryContextMessage,
  extractFacts,
  loadSummary,
  saveSummary,
  clearSummary,
  clearFacts,
  trimWithMemoryModel,
} from '../src/memory.js'

describe('loadSummary', () => {
  beforeEach(() => {
    mockSummaryStore.clear()
    runCalls.length = 0
  })

  test('returns null when no row exists', () => {
    expect(loadSummary(999)).toBeNull()
  })

  test('returns summary string when row exists', () => {
    mockSummaryStore.set(1, 'Previous conversation summary')
    expect(loadSummary(1)).toBe('Previous conversation summary')
  })
})

describe('saveSummary', () => {
  beforeEach(() => {
    mockSummaryStore.clear()
    runCalls.length = 0
  })

  test('persists summary', () => {
    saveSummary(1, 'Test summary')
    expect(mockSummaryStore.get(1)).toBe('Test summary')
  })

  test('calls INSERT OR REPLACE', () => {
    saveSummary(1, 'Test')
    const call = runCalls.find((c) => c.sql.includes('INSERT OR REPLACE INTO memory_summary'))
    expect(call).toBeDefined()
  })
})

describe('clearSummary', () => {
  beforeEach(() => {
    mockSummaryStore.clear()
    runCalls.length = 0
  })

  test('removes summary', () => {
    mockSummaryStore.set(1, 'Summary')
    clearSummary(1)
    expect(mockSummaryStore.has(1)).toBe(false)
  })
})

describe('clearFacts', () => {
  beforeEach(() => {
    mockFactsStore.clear()
    runCalls.length = 0
  })

  test('calls DELETE on memory_facts', () => {
    clearFacts(1)
    const call = runCalls.find((c) => c.sql.includes('DELETE FROM memory_facts') && !c.sql.includes('NOT IN'))
    expect(call).toBeDefined()
    expect(call!.params).toEqual([1])
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
    const result = buildMemoryContextMessage('User created ENG-42', [])
    expect(result).not.toBeNull()
    expect(result!.role).toBe('system')
    expect(result!.content).toContain('Summary: User created ENG-42')
    expect(result!.content).toContain('=== Memory context ===')
  })

  test('returns system message with facts only', () => {
    const facts = [
      {
        identifier: 'ENG-42',
        title: 'Fix login',
        url: 'https://linear.app/ENG-42',
        last_seen: '2026-03-01T00:00:00Z',
      },
    ]
    const result = buildMemoryContextMessage(null, facts)
    expect(result).not.toBeNull()
    expect(result!.content).toContain('ENG-42')
    expect(result!.content).toContain('Fix login')
    expect(result!.content).toContain('Recently accessed issues')
  })

  test('returns combined message with both summary and facts', () => {
    const facts = [{ identifier: 'ENG-42', title: 'Fix login', url: '', last_seen: '2026-03-01T00:00:00Z' }]
    const result = buildMemoryContextMessage('Previous summary', facts)
    expect(result).not.toBeNull()
    expect(result!.content).toContain('Summary: Previous summary')
    expect(result!.content).toContain('ENG-42')
  })

  test('formats last_seen date as YYYY-MM-DD', () => {
    const facts = [{ identifier: 'ENG-1', title: 'Test', url: '', last_seen: '2026-03-05T14:30:00Z' }]
    const result = buildMemoryContextMessage(null, facts)
    expect(result!.content).toContain('last seen 2026-03-05')
  })
})

describe('extractFacts', () => {
  test('extracts fact from create_issue result', () => {
    const results = [
      {
        toolName: 'create_issue',
        result: { identifier: 'ENG-42', title: 'New issue', url: 'https://linear.app/ENG-42' },
      },
    ]
    const facts = extractFacts([], results)
    expect(facts).toHaveLength(1)
    expect(facts[0]!.identifier).toBe('ENG-42')
    expect(facts[0]!.title).toBe('New issue')
    expect(facts[0]!.url).toBe('https://linear.app/ENG-42')
  })

  test('extracts fact from update_issue result', () => {
    const results = [{ toolName: 'update_issue', result: { identifier: 'ENG-38', url: 'https://linear.app/ENG-38' } }]
    const facts = extractFacts([], results)
    expect(facts).toHaveLength(1)
    expect(facts[0]!.identifier).toBe('ENG-38')
    // no title → falls back to identifier
    expect(facts[0]!.title).toBe('ENG-38')
  })

  test('extracts fact from get_issue result', () => {
    const results = [{ toolName: 'get_issue', result: { identifier: 'ENG-10', title: 'Details', url: '' } }]
    const facts = extractFacts([], results)
    expect(facts).toHaveLength(1)
    expect(facts[0]!.identifier).toBe('ENG-10')
  })

  test('extracts up to 3 facts from search_issues result', () => {
    const items = [
      { identifier: 'ENG-1', title: 'A' },
      { identifier: 'ENG-2', title: 'B' },
      { identifier: 'ENG-3', title: 'C' },
      { identifier: 'ENG-4', title: 'D' },
    ]
    const results = [{ toolName: 'search_issues', result: items }]
    const facts = extractFacts([], results)
    expect(facts).toHaveLength(3)
    expect(facts.map((f) => f.identifier)).toEqual(['ENG-1', 'ENG-2', 'ENG-3'])
  })

  test('returns empty array for unknown tool', () => {
    const results = [{ toolName: 'unknown_tool', result: { identifier: 'X' } }]
    const facts = extractFacts([], results)
    expect(facts).toEqual([])
  })

  test('returns empty array for malformed result', () => {
    const results = [{ toolName: 'create_issue', result: { no_identifier: true } }]
    const facts = extractFacts([], results)
    expect(facts).toEqual([])
  })
})

describe('trimWithMemoryModel', () => {
  const makeMessages = (count: number): Array<{ role: 'user' | 'assistant'; content: string }> =>
    Array.from({ length: count }, (_, i) => ({
      role: i % 2 === 0 ? ('user' as const) : ('assistant' as const),
      content: `Message ${i}`,
    }))

  test('returns trimmed messages and summary', async () => {
    const history = makeMessages(5)
    generateObjectImpl = (): Promise<GenerateObjectResult> =>
      Promise.resolve({ object: { keep_indices: [0, 2, 4], summary: 'Test summary' } })

    const result = await trimWithMemoryModel(history, 2, 10, null, {
      apiKey: 'key',
      baseUrl: 'http://localhost',
      model: 'test-model',
    })

    expect(result.trimmedMessages).toHaveLength(3)
    expect(result.trimmedMessages[0]).toEqual(history[0])
    expect(result.trimmedMessages[1]).toEqual(history[2])
    expect(result.trimmedMessages[2]).toEqual(history[4])
    expect(result.summary).toBe('Test summary')
  })

  test('filters out-of-range indices', async () => {
    const history = makeMessages(3)
    generateObjectImpl = (): Promise<GenerateObjectResult> =>
      Promise.resolve({ object: { keep_indices: [0, 1, 99], summary: 'Summary' } })

    const result = await trimWithMemoryModel(history, 1, 10, null, {
      apiKey: 'key',
      baseUrl: 'http://localhost',
      model: 'test-model',
    })

    // 99 is out of range — filtered out
    expect(result.trimmedMessages).toHaveLength(2)
  })

  test('deduplicates indices', async () => {
    const history = makeMessages(5)
    generateObjectImpl = (): Promise<GenerateObjectResult> =>
      Promise.resolve({ object: { keep_indices: [1, 1, 2], summary: 'Summary' } })

    const result = await trimWithMemoryModel(history, 1, 10, null, {
      apiKey: 'key',
      baseUrl: 'http://localhost',
      model: 'test-model',
    })

    expect(result.trimmedMessages).toHaveLength(2)
    expect(result.trimmedMessages[0]).toEqual(history[1])
    expect(result.trimmedMessages[1]).toEqual(history[2])
  })

  test('pads to trimMin when model returns too few indices', async () => {
    const history = makeMessages(10)
    generateObjectImpl = (): Promise<GenerateObjectResult> =>
      Promise.resolve({ object: { keep_indices: [0, 1], summary: 'Summary' } })

    const result = await trimWithMemoryModel(history, 5, 10, null, {
      apiKey: 'key',
      baseUrl: 'http://localhost',
      model: 'test-model',
    })

    expect(result.trimmedMessages.length).toBeGreaterThanOrEqual(5)
  })

  test('caps at trimMax when model returns too many indices', async () => {
    const history = makeMessages(10)
    generateObjectImpl = (): Promise<GenerateObjectResult> =>
      Promise.resolve({ object: { keep_indices: [0, 1, 2, 3, 4, 5, 6, 7, 8, 9], summary: 'Summary' } })

    const result = await trimWithMemoryModel(history, 1, 3, null, {
      apiKey: 'key',
      baseUrl: 'http://localhost',
      model: 'test-model',
    })

    expect(result.trimmedMessages).toHaveLength(3)
  })
})
