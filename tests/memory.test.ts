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
    if (sql.includes('INSERT OR REPLACE INTO memory_facts') && params !== undefined) {
      const userId = String(params[0])
      const fact = {
        identifier: String(params[1]),
        title: String(params[2]),
        url: String(params[3]),
        last_seen: String(params[4]),
      }
      const existing = mockFactsStore.get(userId) ?? []
      const filtered = existing.filter((f) => f.identifier !== fact.identifier)
      filtered.push(fact)
      mockFactsStore.set(userId, filtered)
    }
    if (sql.includes('DELETE FROM memory_facts') && sql.includes('NOT IN') && params !== undefined) {
      const userId = String(params[0])
      const cap = Number(params[2])
      const facts = mockFactsStore.get(userId) ?? []
      if (facts.length > cap) {
        // Sort by last_seen DESC and keep only top 'cap' facts
        const sorted = facts.sort((a, b) => b.last_seen.localeCompare(a.last_seen))
        const toKeep = sorted.slice(0, cap)
        mockFactsStore.set(userId, toKeep)
      }
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
          const facts = mockFactsStore.get(String(userId)) ?? []
          // Sort by last_seen DESC as real DB would
          return facts.sort((a, b) => b.last_seen.localeCompare(a.last_seen))
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

type GenerateTextResult = { output: { keep_indices: number[]; summary: string } }

let generateTextImpl = (): Promise<GenerateTextResult> =>
  Promise.resolve({ output: { keep_indices: [0, 1], summary: 'Updated summary text' } })

void mock.module('ai', () => ({
  generateText: (..._args: unknown[]): Promise<GenerateTextResult> => generateTextImpl(),
  Output: { object: ({ schema }: { schema: unknown }): { schema: unknown } => ({ schema }) },
}))
// --- end mocks ---

import {
  buildMemoryContextMessage,
  extractFacts,
  loadSummary,
  saveSummary,
  loadFacts,
  upsertFact,
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
        url: 'https://example.huly.io/ENG-42',
        last_seen: '2026-03-01T00:00:00Z',
      },
    ]
    const result = buildMemoryContextMessage(null, facts)
    expect(result).not.toBeNull()
    expect(result!.content).toContain('ENG-42')
    expect(result!.content).toContain('Fix login')
    expect(result!.content).toContain('Recently accessed Huly entities')
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
        result: { identifier: 'ENG-42', title: 'New issue', url: 'https://example.huly.io/ENG-42' },
      },
    ]
    const facts = extractFacts([], results)
    expect(facts).toHaveLength(1)
    expect(facts[0]!.identifier).toBe('ENG-42')
    expect(facts[0]!.title).toBe('New issue')
    expect(facts[0]!.url).toBe('https://example.huly.io/ENG-42')
  })

  test('extracts fact from update_issue result', () => {
    const results = [
      { toolName: 'update_issue', result: { identifier: 'ENG-38', url: 'https://example.huly.io/ENG-38' } },
    ]
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

  test('extracts fact from create_project result', () => {
    const results = [
      {
        toolName: 'create_project',
        result: { id: 'proj-123', name: 'Backend Migration', url: 'https://example.huly.io/project/proj-123' },
      },
    ]
    const facts = extractFacts([], results)
    expect(facts).toHaveLength(1)
    expect(facts[0]!.identifier).toBe('proj:proj-123')
    expect(facts[0]!.title).toBe('Backend Migration')
    expect(facts[0]!.url).toBe('https://example.huly.io/project/proj-123')
  })

  test('extracts create_project fact without url', () => {
    const results = [{ toolName: 'create_project', result: { id: 'proj-456', name: 'Frontend Refactor' } }]
    const facts = extractFacts([], results)
    expect(facts).toHaveLength(1)
    expect(facts[0]!.identifier).toBe('proj:proj-456')
    expect(facts[0]!.title).toBe('Frontend Refactor')
    expect(facts[0]!.url).toBe('')
  })

  test('ignores malformed create_project result', () => {
    const results = [{ toolName: 'create_project', result: { no_id: true, name: 'Test' } }]
    const facts = extractFacts([], results)
    expect(facts).toEqual([])
  })
})

describe('upsertFact eviction', () => {
  beforeEach(() => {
    mockFactsStore.clear()
    mockSummaryStore.clear()
    runCalls.length = 0
  })

  test('evicts oldest facts when exceeding FACTS_CAP', () => {
    const userId = 999
    // Insert 52 facts (over the 50 cap)
    for (let i = 0; i < 52; i++) {
      upsertFact(userId, {
        identifier: `ENG-${i}`,
        title: `Issue ${i}`,
        url: `https://example.huly.io/ENG-${i}`,
      })
    }

    const facts = loadFacts(userId)
    // Should be capped at 50 (FACTS_CAP)
    expect(facts).toHaveLength(50)
    // Verify the facts are returned sorted by last_seen DESC
    for (let i = 1; i < facts.length; i++) {
      expect(facts[i]!.last_seen <= facts[i - 1]!.last_seen).toBe(true)
    }

    // Cleanup
    clearFacts(userId)
  })

  test('updates last_seen on duplicate fact insert', async () => {
    const userId = 999
    const fact = { identifier: 'ENG-100', title: 'Test Issue', url: '' }

    upsertFact(userId, fact)
    const firstLoad = loadFacts(userId)
    const firstSeen = firstLoad[0]!.last_seen

    // Small delay to ensure different timestamp
    await Bun.sleep(10)

    upsertFact(userId, fact)
    const secondLoad = loadFacts(userId)
    const secondSeen = secondLoad[0]!.last_seen

    expect(secondSeen).not.toBe(firstSeen)
    expect(secondLoad).toHaveLength(1)

    // Cleanup
    clearFacts(userId)
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
    generateTextImpl = (): Promise<GenerateTextResult> =>
      Promise.resolve({ output: { keep_indices: [0, 2, 4], summary: 'Test summary' } })

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
    generateTextImpl = (): Promise<GenerateTextResult> =>
      Promise.resolve({ output: { keep_indices: [0, 1, 99], summary: 'Summary' } })

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
    generateTextImpl = (): Promise<GenerateTextResult> =>
      Promise.resolve({ output: { keep_indices: [1, 1, 2], summary: 'Summary' } })

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
    generateTextImpl = (): Promise<GenerateTextResult> =>
      Promise.resolve({ output: { keep_indices: [0, 1], summary: 'Summary' } })

    const result = await trimWithMemoryModel(history, 5, 10, null, {
      apiKey: 'key',
      baseUrl: 'http://localhost',
      model: 'test-model',
    })

    expect(result.trimmedMessages.length).toBeGreaterThanOrEqual(5)
  })

  test('caps at trimMax when model returns too many indices', async () => {
    const history = makeMessages(10)
    generateTextImpl = (): Promise<GenerateTextResult> =>
      Promise.resolve({ output: { keep_indices: [0, 1, 2, 3, 4, 5, 6, 7, 8, 9], summary: 'Summary' } })

    const result = await trimWithMemoryModel(history, 1, 3, null, {
      apiKey: 'key',
      baseUrl: 'http://localhost',
      model: 'test-model',
    })

    expect(result.trimmedMessages).toHaveLength(3)
  })
})
