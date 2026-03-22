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
  checkBlocked,
  checkDeadlineNudge,
  checkDueToday,
  checkOverdue,
  checkStaleness,
  runAlertCycleForAllUsers,
  updateAlertState,
} from '../../src/proactive/service.js'
import type { Task, TaskListItem } from '../../src/providers/types.js'
import { createMockProvider } from '../tools/mock-provider.js'

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

describe('checkBlocked', () => {
  const makeFullTask = (overrides: Partial<Task> = {}): Task => ({
    id: 'task-1',
    title: 'Test Task',
    status: 'in-progress',
    url: 'https://example.com/task-1',
    ...overrides,
  })

  beforeEach(async () => {
    await setupTestDb()
  })

  test('returns null when task has no due date', async () => {
    const provider = createMockProvider()
    const task = makeTask({ dueDate: undefined })
    const result = await checkBlocked('user1', task, 'UTC', provider)
    expect(result).toBeNull()
  })

  test('returns null when task due date is beyond tomorrow', async () => {
    const provider = createMockProvider()
    const farFuture = new Date(Date.now() + 3 * 24 * 60 * 60 * 1000).toISOString().slice(0, 10)
    const task = makeTask({ dueDate: farFuture })
    const result = await checkBlocked('user1', task, 'UTC', provider)
    expect(result).toBeNull()
  })

  test('returns null when task is terminal', async () => {
    const provider = createMockProvider()
    const task = makeTask({ dueDate: today(), status: 'done' })
    const result = await checkBlocked('user1', task, 'UTC', provider)
    expect(result).toBeNull()
  })

  test('returns null when provider lacks tasks.relations capability', async () => {
    const provider = createMockProvider({
      capabilities: new Set(['projects.list' as const]),
    })
    const task = makeTask({ dueDate: today() })
    const result = await checkBlocked('user1', task, 'UTC', provider)
    expect(result).toBeNull()
  })

  test('returns null when task has no blocked_by relations', async () => {
    const provider = createMockProvider({
      getTask: () => Promise.resolve(makeFullTask({ relations: [] })),
    })
    const task = makeTask({ dueDate: today() })
    const result = await checkBlocked('user1', task, 'UTC', provider)
    expect(result).toBeNull()
  })

  test('returns alert when blocker is non-terminal and task due today', async () => {
    let callCount = 0
    const provider = createMockProvider({
      getTask: (taskId: string): Promise<Task> => {
        callCount++
        if (callCount === 1) {
          return Promise.resolve(makeFullTask({ id: taskId, relations: [{ type: 'blocked_by', taskId: 'blocker-1' }] }))
        }
        return Promise.resolve(makeFullTask({ id: 'blocker-1', title: 'Blocking Task', status: 'in-progress' }))
      },
    })
    const task = makeTask({ dueDate: today() })
    const result = await checkBlocked('user1', task, 'UTC', provider)
    expect(result).not.toBeNull()
    expect(result).toContain('🚧')
    expect(result).toContain('Blocking Task')
  })

  test('returns null when blocker is terminal', async () => {
    let callCount = 0
    const provider = createMockProvider({
      getTask: (taskId: string): Promise<Task> => {
        callCount++
        if (callCount === 1) {
          return Promise.resolve(makeFullTask({ id: taskId, relations: [{ type: 'blocked_by', taskId: 'blocker-1' }] }))
        }
        return Promise.resolve(makeFullTask({ id: 'blocker-1', title: 'Done Blocker', status: 'done' }))
      },
    })
    const task = makeTask({ dueDate: today() })
    const result = await checkBlocked('user1', task, 'UTC', provider)
    expect(result).toBeNull()
  })

  test('returns null when already suppressed', async () => {
    const provider = createMockProvider({
      getTask: (taskId: string): Promise<Task> => {
        if (taskId === 'task-blocked') {
          return Promise.resolve(makeFullTask({ id: taskId, relations: [{ type: 'blocked_by', taskId: 'blocker-1' }] }))
        }
        return Promise.resolve(makeFullTask({ id: 'blocker-1', title: 'Blocker', status: 'in-progress' }))
      },
    })
    const task = makeTask({ id: 'task-blocked', dueDate: today() })
    // First call sets suppression
    await checkBlocked('user1', task, 'UTC', provider)
    // Second call should be suppressed
    const result = await checkBlocked('user1', task, 'UTC', provider)
    expect(result).toBeNull()
  })
})

describe('runAlertCycleForAllUsers', () => {
  beforeEach(async () => {
    await setupTestDb()
  })

  test('skips users when provider builder returns null', async () => {
    const sent: string[] = []
    const sendFn = (_userId: string, msg: string): Promise<void> => {
      sent.push(msg)
      return Promise.resolve()
    }
    await runAlertCycleForAllUsers(() => null, sendFn)
    expect(sent).toHaveLength(0)
  })

  test('runs alert cycle for users whose provider can be built', async () => {
    // Insert a user directly into the DB so listUsers() returns them
    const db = getDrizzleDb()
    const { users } = await import('../../src/db/schema.js')
    db.insert(users).values({ platformUserId: 'test-eligible', addedBy: 'admin' }).run()

    const provider = createMockProvider({
      listProjects: () => Promise.resolve([]),
      searchTasks: () => Promise.resolve([]),
    })

    const sent: string[] = []
    await runAlertCycleForAllUsers(
      (userId) => (userId === 'test-eligible' ? provider : null),
      (_userId, msg) => {
        sent.push(msg)
        return Promise.resolve()
      },
    )
    // No tasks → no alerts, but cycle ran without error
    expect(sent).toHaveLength(0)
  })
})

afterAll(() => {
  mock.restore()
})
