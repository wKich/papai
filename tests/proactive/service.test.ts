import { afterAll, beforeEach, describe, expect, mock, test } from 'bun:test'

import { eq, and } from 'drizzle-orm'

import { mockLogger, setupTestDb, mockDrizzle } from '../utils/test-helpers.js'

mockLogger()
mockDrizzle()

// Mock getConfig for timezone
void mock.module('../../src/config.js', () => ({
  getConfig: (_userId: string, key: string): string | null => {
    if (key === 'timezone') return 'UTC'
    if (key === 'briefing_timezone') return null
    if (key === 'staleness_days') return '7'
    if (key === 'deadline_nudges') return 'enabled'
    return null
  },
  isConfigKey: (): boolean => true,
  getAllConfig: (): Record<string, string> => ({}),
  setConfig: (): void => {},
  maskValue: (_k: string, v: string): string => v,
}))

import { getDrizzleDb } from '../../src/db/drizzle.js'
import { alertState } from '../../src/db/schema.js'
import {
  checkDeadlineNudge,
  checkDueToday,
  checkOverdue,
  checkStaleness,
  updateAlertState,
} from '../../src/proactive/service.js'
import type { TaskListItem } from '../../src/providers/types.js'

const makeTask = (overrides: Partial<TaskListItem> = {}): TaskListItem => ({
  id: 'task-1',
  title: 'Test Task',
  number: 1,
  status: 'in-progress',
  priority: 'high',
  dueDate: undefined,
  url: 'https://example.com/task-1',
  ...overrides,
})

const today = (): string => new Date().toISOString().slice(0, 10)
const tomorrow = (): string => new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString().slice(0, 10)
const yesterday = (): string => new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString().slice(0, 10)
const daysAgo = (n: number): string => new Date(Date.now() - n * 24 * 60 * 60 * 1000).toISOString().slice(0, 10)

const clearSuppression = (userId: string, taskId: string): void => {
  const db = getDrizzleDb()
  db.update(alertState)
    .set({ suppressUntil: new Date(Date.now() - 1000).toISOString() })
    .where(and(eq(alertState.userId, userId), eq(alertState.taskId, taskId)))
    .run()
}

describe('ProactiveAlertService', () => {
  beforeEach(async () => {
    await setupTestDb()
  })

  describe('checkDeadlineNudge', () => {
    test('returns message for task due tomorrow', () => {
      const task = makeTask({ dueDate: tomorrow() })
      const result = checkDeadlineNudge('user1', task, 'UTC')
      expect(result).toContain('due tomorrow')
      expect(result).toContain('Test Task')
    })

    test('returns null for task due in 3 days', () => {
      const futureDate = new Date(Date.now() + 3 * 24 * 60 * 60 * 1000).toISOString().slice(0, 10)
      const task = makeTask({ dueDate: futureDate })
      const result = checkDeadlineNudge('user1', task, 'UTC')
      expect(result).toBeNull()
    })

    test('returns null for task with no due date', () => {
      const task = makeTask({ dueDate: undefined })
      const result = checkDeadlineNudge('user1', task, 'UTC')
      expect(result).toBeNull()
    })

    test('returns null for terminal task', () => {
      const task = makeTask({ dueDate: tomorrow(), status: 'done' })
      const result = checkDeadlineNudge('user1', task, 'UTC')
      expect(result).toBeNull()
    })

    test('returns null if already suppressed within window', () => {
      const task = makeTask({ dueDate: tomorrow() })
      checkDeadlineNudge('user1', task, 'UTC')
      const result = checkDeadlineNudge('user1', task, 'UTC')
      expect(result).toBeNull()
    })
  })

  describe('checkDueToday', () => {
    test('returns message for task due today', () => {
      const task = makeTask({ dueDate: today() })
      const result = checkDueToday('user1', task, 'UTC')
      expect(result).toContain('due today')
      expect(result).toContain('Test Task')
    })

    test('returns null if already suppressed within window', () => {
      const task = makeTask({ dueDate: today() })
      checkDueToday('user1', task, 'UTC')
      const result = checkDueToday('user1', task, 'UTC')
      expect(result).toBeNull()
    })
  })

  describe('checkOverdue', () => {
    test('with 0 prior notifications returns soft tone', () => {
      const task = makeTask({ id: 'overdue-1', dueDate: yesterday() })
      const result = checkOverdue('user1', task, 'UTC')
      expect(result).toContain('⚠️')
      expect(result).toContain('overdue')
      expect(result).toContain('Please update its status')
    })

    test('with 3 prior notifications returns moderate tone', () => {
      const task = makeTask({ id: 'overdue-2', dueDate: daysAgo(4) })
      updateAlertState('user1', 'overdue-2', 'in-progress', 'overdue')
      updateAlertState('user1', 'overdue-2', 'in-progress', 'overdue')
      updateAlertState('user1', 'overdue-2', 'in-progress', 'overdue')

      clearSuppression('user1', 'overdue-2')

      const result = checkOverdue('user1', task, 'UTC')
      expect(result).toContain('🔴')
      expect(result).toContain('resolve or escalate')
    })

    test('with 7 prior notifications returns urgent tone', () => {
      const task = makeTask({ id: 'overdue-3', dueDate: daysAgo(8) })
      for (let i = 0; i < 7; i++) {
        updateAlertState('user1', 'overdue-3', 'in-progress', 'overdue')
      }

      clearSuppression('user1', 'overdue-3')

      const result = checkOverdue('user1', task, 'UTC')
      expect(result).toContain('🚨')
      expect(result).toContain('Immediate action required')
    })

    test('returns null for terminal task', () => {
      const task = makeTask({ dueDate: yesterday(), status: 'completed' })
      const result = checkOverdue('user1', task, 'UTC')
      expect(result).toBeNull()
    })
  })

  describe('checkStaleness', () => {
    test('returns null on first encounter (records state)', () => {
      const task = makeTask({ id: 'stale-1' })
      const result = checkStaleness('user1', task, 7)
      expect(result).toBeNull()
    })

    test('returns message when inactive for threshold days', () => {
      const task = makeTask({ id: 'stale-2' })
      checkStaleness('user1', task, 7)

      const db = getDrizzleDb()
      db.update(alertState)
        .set({ lastStatusChangedAt: new Date(Date.now() - 8 * 24 * 60 * 60 * 1000).toISOString() })
        .where(and(eq(alertState.userId, 'user1'), eq(alertState.taskId, 'stale-2')))
        .run()

      const result = checkStaleness('user1', task, 7)
      expect(result).toContain('no activity')
      expect(result).toContain('Test Task')
    })

    test('returns null when status changed within threshold', () => {
      const task = makeTask({ id: 'stale-3' })
      checkStaleness('user1', task, 7)
      const result = checkStaleness('user1', task, 7)
      expect(result).toBeNull()
    })
  })

  describe('updateAlertState', () => {
    test('resets last_status_changed_at when status differs', () => {
      updateAlertState('user1', 'task-x', 'todo')

      const db = getDrizzleDb()
      db.update(alertState)
        .set({ lastStatusChangedAt: '2020-01-01T00:00:00.000Z' })
        .where(and(eq(alertState.userId, 'user1'), eq(alertState.taskId, 'task-x')))
        .run()

      updateAlertState('user1', 'task-x', 'in-progress')

      const after = db
        .select()
        .from(alertState)
        .where(and(eq(alertState.userId, 'user1'), eq(alertState.taskId, 'task-x')))
        .get()

      expect(after!.lastSeenStatus).toBe('in-progress')
      expect(after!.lastStatusChangedAt).not.toBe('2020-01-01T00:00:00.000Z')
    })

    test('does not reset last_status_changed_at when status is unchanged', () => {
      updateAlertState('user1', 'task-y', 'todo')

      const db = getDrizzleDb()
      db.update(alertState)
        .set({ lastStatusChangedAt: '2020-01-01T00:00:00.000Z' })
        .where(and(eq(alertState.userId, 'user1'), eq(alertState.taskId, 'task-y')))
        .run()

      updateAlertState('user1', 'task-y', 'todo')

      const after = db
        .select()
        .from(alertState)
        .where(and(eq(alertState.userId, 'user1'), eq(alertState.taskId, 'task-y')))
        .get()

      expect(after!.lastStatusChangedAt).toBe('2020-01-01T00:00:00.000Z')
    })
  })
})

afterAll(() => {
  mock.restore()
})
