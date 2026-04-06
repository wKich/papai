import { beforeEach, describe, expect, test } from 'bun:test'

import Fuse from 'fuse.js'

import {
  createLogSearchIndex,
  getSearchIndex,
  searchLogs,
  updateSearchIndex,
} from '../../../client/debug/search.js'
import type { LogEntry } from '../../../src/debug/schemas.js'

describe('fuse search', () => {
  beforeEach(() => {
    // Reset the global index
    updateSearchIndex([])
  })

  test('createLogSearchIndex returns Fuse instance', () => {
    const logs: LogEntry[] = [{ time: '2024-01-15T10:30:00.000Z', level: 30, msg: 'Test message' }]
    const fuse = createLogSearchIndex(logs)
    expect(fuse).toBeInstanceOf(Fuse)
  })

  test('searches in message field with fuzzy matching', () => {
    const logs: LogEntry[] = [
      { time: '2024-01-15T10:30:00.000Z', level: 30, msg: 'Processing completed' },
      { time: '2024-01-15T10:31:00.000Z', level: 30, msg: 'Task failed' },
    ]
    const fuse = createLogSearchIndex(logs)

    const results = searchLogs(fuse, 'completed')
    expect(results).toHaveLength(1)
    expect(results[0]!.msg).toBe('Processing completed')
  })

  test('searches in nested object properties', () => {
    const logs: LogEntry[] = [
      {
        time: '2024-01-15T10:30:00.000Z',
        level: 30,
        msg: 'API call',
        error: {
          code: 'ECONNREFUSED',
          details: { host: 'api.example.com' },
        },
      },
    ]
    const fuse = createLogSearchIndex(logs)

    const results = searchLogs(fuse, 'ECONNREFUSED')
    expect(results).toHaveLength(1)
  })

  test('searches in scope field', () => {
    const logs: LogEntry[] = [
      { time: '2024-01-15T10:30:00.000Z', level: 30, msg: 'Task started', scope: 'scheduler' },
      { time: '2024-01-15T10:31:00.000Z', level: 30, msg: 'Task done', scope: 'worker' },
    ]
    const fuse = createLogSearchIndex(logs)

    const results = searchLogs(fuse, 'scheduler')
    expect(results).toHaveLength(1)
    expect(results[0]!.scope).toBe('scheduler')
  })

  test('fuzzy search tolerates typos', () => {
    const logs: LogEntry[] = [{ time: '2024-01-15T10:30:00.000Z', level: 30, msg: 'completed successfully' }]
    const fuse = createLogSearchIndex(logs)

    // Slight typo should still match
    const results = searchLogs(fuse, 'complet')
    expect(results.length).toBeGreaterThan(0)
  })

  test('searchLogs returns empty array for empty query', () => {
    const logs: LogEntry[] = [{ time: '2024-01-15T10:30:00.000Z', level: 30, msg: 'Test' }]
    const fuse = createLogSearchIndex(logs)

    const results = searchLogs(fuse, '')
    expect(results).toHaveLength(0)
  })

  test('searchLogs returns empty array for null fuse', () => {
    const results = searchLogs(null, 'query')
    expect(results).toHaveLength(0)
  })

  test('updateSearchIndex updates global instance', () => {
    const logs: LogEntry[] = [{ time: '2024-01-15T10:30:00.000Z', level: 30, msg: 'Global test' }]
    updateSearchIndex(logs)

    const index = getSearchIndex()
    expect(index).not.toBeNull()
    expect(index).toBeInstanceOf(Fuse)

    const results = searchLogs(index, 'Global')
    expect(results).toHaveLength(1)
  })

  test('searches in property keys', () => {
    const logs: LogEntry[] = [
      {
        time: '2024-01-15T10:30:00.000Z',
        level: 30,
        msg: 'Event',
        userId: 'user-123',
      },
    ]
    const fuse = createLogSearchIndex(logs)

    const results = searchLogs(fuse, 'userId')
    expect(results).toHaveLength(1)
  })

  test('searches in array values', () => {
    const logs: LogEntry[] = [
      {
        time: '2024-01-15T10:30:00.000Z',
        level: 30,
        msg: 'Batch',
        items: ['item-1', 'item-2', 'item-3'],
      },
    ]
    const fuse = createLogSearchIndex(logs)

    const results = searchLogs(fuse, 'item-2')
    expect(results).toHaveLength(1)
  })
})
