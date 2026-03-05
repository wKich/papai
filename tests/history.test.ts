import { mock, describe, expect, test, beforeEach } from 'bun:test'

// --- bun:sqlite mock (must come before importing history.ts) ---
const mockStore = new Map<number, string>()
const runCalls: Array<{ sql: string; params?: unknown[] }> = []

class MockDatabase {
  run(sql: string, params?: unknown[]): void {
    runCalls.push({ sql, params })
    if (sql.includes('INSERT OR REPLACE INTO conversation_history') && params !== undefined) {
      const userId = Number(params[0])
      const messages = String(params[1])
      mockStore.set(userId, messages)
    }
    if (sql.includes('DELETE FROM conversation_history') && params !== undefined) {
      const userId = Number(params[0])
      mockStore.delete(userId)
    }
  }

  query(sql: string): { get: (userId: number) => { messages: string } | null; all: () => unknown[] } {
    if (sql.includes('SELECT messages FROM conversation_history')) {
      return {
        get: (userId: number): { messages: string } | null => {
          const messages = mockStore.get(userId)
          return messages !== undefined ? { messages } : null
        },
        all: (): unknown[] => [],
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
// --- end mock ---

import type { ModelMessage } from 'ai'

import { loadHistory, saveHistory, clearHistory } from '../src/history.js'

describe('loadHistory', () => {
  beforeEach(() => {
    mockStore.clear()
    runCalls.length = 0
  })

  test('returns empty array when no row exists', () => {
    const result = loadHistory(999)
    expect(result).toEqual([])
  })

  test('returns deserialised messages for valid row', () => {
    const messages = [
      { role: 'user', content: 'hello' },
      { role: 'assistant', content: 'hi there' },
    ]
    mockStore.set(1, JSON.stringify(messages))

    const result = loadHistory(1)
    expect(result).toHaveLength(2)
    expect(result[0]).toEqual({ role: 'user', content: 'hello' })
    expect(result[1]).toEqual({ role: 'assistant', content: 'hi there' })
  })

  test('returns empty array for corrupt JSON', () => {
    mockStore.set(2, 'not-valid-json')

    const result = loadHistory(2)
    expect(result).toEqual([])
  })

  test('returns empty array when messages lack role field', () => {
    mockStore.set(3, JSON.stringify([{ content: 'no role' }]))

    const result = loadHistory(3)
    expect(result).toEqual([])
  })

  test('preserves extra fields', () => {
    const messages = [{ role: 'assistant', content: 'hi', toolCalls: [{ id: '1' }] }]
    mockStore.set(4, JSON.stringify(messages))

    const result = loadHistory(4)
    expect(result).toHaveLength(1)
    const first = result[0]
    expect(first).toBeDefined()
    expect('toolCalls' in first).toBe(true)
  })
})

describe('saveHistory', () => {
  beforeEach(() => {
    mockStore.clear()
    runCalls.length = 0
  })

  test('persists messages as JSON', () => {
    const messages: ModelMessage[] = [{ role: 'user', content: 'test' }]
    saveHistory(10, messages)

    const saved = mockStore.get(10)
    expect(saved).toBeDefined()
    expect(JSON.parse(saved!)).toEqual(messages)
  })

  test('calls INSERT OR REPLACE', () => {
    const empty: ModelMessage[] = []
    saveHistory(10, empty)

    const insertCall = runCalls.find((c) => c.sql.includes('INSERT OR REPLACE INTO conversation_history'))
    expect(insertCall).toBeDefined()
  })
})

describe('clearHistory', () => {
  beforeEach(() => {
    mockStore.clear()
    runCalls.length = 0
  })

  test('removes entry from store', () => {
    mockStore.set(20, JSON.stringify([]))
    clearHistory(20)
    expect(mockStore.has(20)).toBe(false)
  })

  test('calls DELETE statement', () => {
    clearHistory(20)

    const deleteCall = runCalls.find((c) => c.sql.includes('DELETE FROM conversation_history'))
    expect(deleteCall).toBeDefined()
    expect(deleteCall!.params).toEqual([20])
  })
})
