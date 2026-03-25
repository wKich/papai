import { afterAll, beforeEach, describe, expect, mock, test } from 'bun:test'

import { eq } from 'drizzle-orm'

import * as schema from '../../src/db/schema.js'
import { mockDrizzle, mockLogger, setupTestDb, getTestDb } from '../utils/test-helpers.js'

mockLogger()
mockDrizzle()

import {
  consumeUnseenEvents,
  formatBackgroundEventsMessage,
  loadUnseenEvents,
  markEventsInjected,
  pruneBackgroundEvents,
  recordBackgroundEvent,
} from '../../src/deferred-prompts/background-events.js'

beforeEach(async () => {
  await setupTestDb()
})

afterAll(() => {
  mock.restore()
})

describe('recordBackgroundEvent', () => {
  test('inserts a row with injectedAt null', () => {
    recordBackgroundEvent('user-1', 'scheduled', 'create report', 'Created report task.')
    const rows = getTestDb().select().from(schema.backgroundEvents).all()
    expect(rows).toHaveLength(1)
    expect(rows[0]!.userId).toBe('user-1')
    expect(rows[0]!.type).toBe('scheduled')
    expect(rows[0]!.injectedAt).toBeNull()
  })
})

describe('loadUnseenEvents', () => {
  test('returns only rows with injectedAt null for the given user', () => {
    recordBackgroundEvent('user-1', 'scheduled', 'task A', 'Done A.')
    recordBackgroundEvent('user-1', 'alert', 'task B', 'Done B.')
    recordBackgroundEvent('user-2', 'scheduled', 'task C', 'Done C.')

    const events = loadUnseenEvents('user-1')
    expect(events).toHaveLength(2)
    expect(events.every((e) => e.userId === 'user-1')).toBe(true)
  })

  test('excludes already injected events', () => {
    recordBackgroundEvent('user-1', 'scheduled', 'old task', 'Done.')
    getTestDb()
      .update(schema.backgroundEvents)
      .set({ injectedAt: new Date().toISOString() })
      .where(eq(schema.backgroundEvents.userId, 'user-1'))
      .run()
    recordBackgroundEvent('user-1', 'alert', 'new task', 'Done.')

    const events = loadUnseenEvents('user-1')
    expect(events).toHaveLength(1)
    expect(events[0]!.prompt).toBe('new task')
  })

  test('returns events ordered by createdAt ascending', () => {
    getTestDb()
      .insert(schema.backgroundEvents)
      .values({
        id: 'a',
        userId: 'user-1',
        type: 'scheduled',
        prompt: 'first',
        response: 'r',
        createdAt: '2026-03-24T09:00:00Z',
      })
      .run()
    getTestDb()
      .insert(schema.backgroundEvents)
      .values({
        id: 'b',
        userId: 'user-1',
        type: 'alert',
        prompt: 'second',
        response: 'r',
        createdAt: '2026-03-24T09:05:00Z',
      })
      .run()

    const events = loadUnseenEvents('user-1')
    expect(events[0]!.prompt).toBe('first')
    expect(events[1]!.prompt).toBe('second')
  })

  test('returns empty array when no unseen events', () => {
    expect(loadUnseenEvents('user-1')).toEqual([])
  })
})

describe('markEventsInjected', () => {
  test('sets injectedAt on the specified ids', () => {
    recordBackgroundEvent('user-1', 'scheduled', 'task', 'Done.')
    const events = loadUnseenEvents('user-1')
    const ids = events.map((e) => e.id)

    markEventsInjected(ids)

    const unseen = loadUnseenEvents('user-1')
    expect(unseen).toHaveLength(0)
  })

  test('does not affect other rows', () => {
    recordBackgroundEvent('user-1', 'scheduled', 'task A', 'Done A.')
    recordBackgroundEvent('user-1', 'alert', 'task B', 'Done B.')
    const [first] = loadUnseenEvents('user-1')

    markEventsInjected([first!.id])

    const unseen = loadUnseenEvents('user-1')
    expect(unseen).toHaveLength(1)
    expect(unseen[0]!.prompt).toBe('task B')
  })

  test('no-ops on empty array', () => {
    expect(() => markEventsInjected([])).not.toThrow()
  })
})

describe('pruneBackgroundEvents', () => {
  test('deletes events older than the given days', () => {
    const oldDate = new Date(Date.now() - 31 * 24 * 60 * 60 * 1000).toISOString()
    getTestDb()
      .insert(schema.backgroundEvents)
      .values({
        id: 'old',
        userId: 'user-1',
        type: 'scheduled',
        prompt: 'old task',
        response: 'Done.',
        createdAt: oldDate,
        injectedAt: oldDate,
      })
      .run()
    recordBackgroundEvent('user-1', 'scheduled', 'new task', 'Done.')

    pruneBackgroundEvents(30)

    const rows = getTestDb().select({ id: schema.backgroundEvents.id }).from(schema.backgroundEvents).all()
    expect(rows).toHaveLength(1)
    expect(rows[0]!.id).not.toBe('old')
  })

  test('keeps events within retention period', () => {
    recordBackgroundEvent('user-1', 'scheduled', 'recent', 'Done.')
    pruneBackgroundEvents(30)
    const rows = getTestDb().select({ id: schema.backgroundEvents.id }).from(schema.backgroundEvents).all()
    expect(rows).toHaveLength(1)
  })

  test('preserves old un-injected events', () => {
    const oldDate = new Date(Date.now() - 31 * 24 * 60 * 60 * 1000).toISOString()
    getTestDb()
      .insert(schema.backgroundEvents)
      .values({
        id: 'old-unseen',
        userId: 'user-1',
        type: 'alert',
        prompt: 'never delivered',
        response: 'Important alert.',
        createdAt: oldDate,
        injectedAt: null,
      })
      .run()

    pruneBackgroundEvents(30)

    const rows = getTestDb().select({ id: schema.backgroundEvents.id }).from(schema.backgroundEvents).all()
    expect(rows).toHaveLength(1)
    expect(rows[0]!.id).toBe('old-unseen')
  })
})

describe('formatBackgroundEventsMessage', () => {
  test('formats a single event with timestamp and type', () => {
    const result = formatBackgroundEventsMessage([
      { type: 'scheduled', prompt: 'create report', response: 'Report created.', createdAt: '2026-03-24T09:00:00Z' },
    ])
    expect(result).toContain('[Background tasks completed while you were away]')
    expect(result).toContain('scheduled')
    expect(result).toContain('create report')
    expect(result).toContain('→ Report created.')
  })

  test('formats multiple events separated by double newlines', () => {
    const result = formatBackgroundEventsMessage([
      { type: 'scheduled', prompt: 'task A', response: 'Done A.', createdAt: '2026-03-24T09:00:00Z' },
      { type: 'alert', prompt: 'task B', response: 'Done B.', createdAt: '2026-03-24T09:05:00Z' },
    ])
    expect(result).toContain('task A')
    expect(result).toContain('task B')
    expect(result).toContain('→ Done A.')
    expect(result).toContain('→ Done B.')
  })

  test('converts timestamps to UTC format', () => {
    const result = formatBackgroundEventsMessage([
      { type: 'scheduled', prompt: 'test', response: 'ok', createdAt: '2026-03-24T09:00:00Z' },
    ])
    expect(result).toContain('UTC')
    expect(result).not.toContain('GMT')
  })
})

describe('consumeUnseenEvents', () => {
  test('returns null when no unseen events exist', () => {
    expect(consumeUnseenEvents('user-1')).toBeNull()
  })

  test('returns systemContent, historyEntries, and eventIds for unseen events', () => {
    recordBackgroundEvent('user-1', 'scheduled', 'create report', 'Report created.')
    recordBackgroundEvent('user-1', 'alert', 'check overdue', '2 overdue.')

    const result = consumeUnseenEvents('user-1')
    expect(result).not.toBeNull()
    expect(result!.eventIds).toHaveLength(2)
    expect(result!.systemContent).toContain('Background tasks completed')
    expect(result!.systemContent).toContain('create report')
    expect(result!.systemContent).toContain('check overdue')
    expect(result!.historyEntries).toHaveLength(2)
    expect(result!.historyEntries[0]!.role).toBe('system')
    expect(result!.historyEntries[0]!.content).toContain('create report')
    expect(result!.historyEntries[1]!.content).toContain('check overdue')
  })

  test('does not mark events as injected (deferred marking)', () => {
    recordBackgroundEvent('user-1', 'scheduled', 'task A', 'Done A.')

    const result = consumeUnseenEvents('user-1')
    expect(result).not.toBeNull()

    // Events should still be unseen since consumeUnseenEvents no longer marks them
    const unseen = loadUnseenEvents('user-1')
    expect(unseen).toHaveLength(1)
  })

  test('returns events in chronological order', () => {
    getTestDb()
      .insert(schema.backgroundEvents)
      .values({
        id: 'a',
        userId: 'user-1',
        type: 'scheduled',
        prompt: 'first',
        response: 'r1',
        createdAt: '2026-03-24T09:00:00Z',
      })
      .run()
    getTestDb()
      .insert(schema.backgroundEvents)
      .values({
        id: 'b',
        userId: 'user-1',
        type: 'alert',
        prompt: 'second',
        response: 'r2',
        createdAt: '2026-03-24T09:05:00Z',
      })
      .run()

    const result = consumeUnseenEvents('user-1')
    expect(result).not.toBeNull()
    expect(result!.eventIds).toEqual(['a', 'b'])
    expect(result!.historyEntries[0]!.content).toContain('first')
    expect(result!.historyEntries[1]!.content).toContain('second')
  })
})
