import { Database } from 'bun:sqlite'
import { mock, describe, expect, test, beforeEach } from 'bun:test'

import { drizzle } from 'drizzle-orm/bun-sqlite'

import * as schema from '../src/db/schema.js'

// --- Test database setup ---
let testDb: ReturnType<typeof drizzle<typeof schema>>
let testSqlite: Database

// Mock logger
void mock.module('../src/logger.js', () => ({
  logger: {
    debug: (): void => {},
    info: (): void => {},
    warn: (): void => {},
    error: (): void => {},
    child: (): object => ({
      debug: (): void => {},
      info: (): void => {},
      warn: (): void => {},
      error: (): void => {},
    }),
  },
}))

// Mock getDrizzleDb
void mock.module('../src/db/drizzle.js', () => ({
  getDrizzleDb: (): ReturnType<typeof drizzle<typeof schema>> => testDb,
  closeDrizzleDb: (): void => {},
  _resetDrizzleDb: (): void => {},
  _setDrizzleDb: (): void => {},
}))

import {
  createRecurringTask,
  deleteRecurringTask,
  getDueRecurringTasks,
  getRecurringTask,
  listRecurringTasks,
  markExecuted,
  pauseRecurringTask,
  resumeRecurringTask,
  skipNextOccurrence,
  updateRecurringTask,
} from '../src/recurring.js'

const USER_ID = 'test-user-1'
const PROJECT_ID = 'project-1'

beforeEach(() => {
  testSqlite = new Database(':memory:')
  testSqlite.run('PRAGMA journal_mode=WAL')
  testSqlite.run('PRAGMA foreign_keys=ON')
  testDb = drizzle(testSqlite, { schema })

  // Create the recurring_tasks table
  testSqlite.run(`
    CREATE TABLE recurring_tasks (
      id TEXT PRIMARY KEY,
      user_id TEXT NOT NULL,
      project_id TEXT NOT NULL,
      title TEXT NOT NULL,
      description TEXT,
      priority TEXT,
      status TEXT,
      assignee TEXT,
      labels TEXT,
      trigger_type TEXT NOT NULL DEFAULT 'cron',
      cron_expression TEXT,
      timezone TEXT NOT NULL DEFAULT 'UTC',
      enabled TEXT NOT NULL DEFAULT '1',
      catch_up TEXT NOT NULL DEFAULT '0',
      last_run TEXT,
      next_run TEXT,
      created_at TEXT DEFAULT (datetime('now')) NOT NULL,
      updated_at TEXT DEFAULT (datetime('now')) NOT NULL
    )
  `)
  testSqlite.run('CREATE INDEX idx_recurring_tasks_user ON recurring_tasks(user_id)')
  testSqlite.run('CREATE INDEX idx_recurring_tasks_enabled_next ON recurring_tasks(enabled, next_run)')
})

describe('createRecurringTask', () => {
  test('creates a cron-based recurring task', () => {
    const task = createRecurringTask({
      userId: USER_ID,
      projectId: PROJECT_ID,
      title: 'Weekly sync',
      triggerType: 'cron',
      cronExpression: '0 9 * * 1',
    })

    expect(task.id).toBeDefined()
    expect(task.title).toBe('Weekly sync')
    expect(task.triggerType).toBe('cron')
    expect(task.cronExpression).toBe('0 9 * * 1')
    expect(task.enabled).toBe(true)
    expect(task.nextRun).not.toBeNull()
  })

  test('creates an on_complete recurring task', () => {
    const task = createRecurringTask({
      userId: USER_ID,
      projectId: PROJECT_ID,
      title: 'Deploy review',
      triggerType: 'on_complete',
    })

    expect(task.triggerType).toBe('on_complete')
    expect(task.nextRun).toBeNull()
  })

  test('carries over labels, priority, and assignee', () => {
    const task = createRecurringTask({
      userId: USER_ID,
      projectId: PROJECT_ID,
      title: 'Weekly ops',
      triggerType: 'cron',
      cronExpression: '0 9 * * 1',
      priority: 'high',
      assignee: 'alice',
      labels: ['label-1', 'label-2'],
    })

    expect(task.priority).toBe('high')
    expect(task.assignee).toBe('alice')
    expect(task.labels).toEqual(['label-1', 'label-2'])
  })
})

describe('listRecurringTasks', () => {
  test('lists all tasks for a user', () => {
    createRecurringTask({
      userId: USER_ID,
      projectId: PROJECT_ID,
      title: 'Task 1',
      triggerType: 'cron',
      cronExpression: '0 9 * * 1',
    })
    createRecurringTask({
      userId: USER_ID,
      projectId: PROJECT_ID,
      title: 'Task 2',
      triggerType: 'cron',
      cronExpression: '0 9 * * 5',
    })
    createRecurringTask({
      userId: 'other-user',
      projectId: PROJECT_ID,
      title: 'Other',
      triggerType: 'cron',
      cronExpression: '0 0 * * *',
    })

    const tasks = listRecurringTasks(USER_ID)
    expect(tasks).toHaveLength(2)
    expect(tasks.map((t) => t.title)).toEqual(['Task 1', 'Task 2'])
  })

  test('returns empty array for user with no tasks', () => {
    const tasks = listRecurringTasks('no-tasks-user')
    expect(tasks).toHaveLength(0)
  })
})

describe('updateRecurringTask', () => {
  test('updates title and priority', () => {
    const task = createRecurringTask({
      userId: USER_ID,
      projectId: PROJECT_ID,
      title: 'Old',
      triggerType: 'cron',
      cronExpression: '0 9 * * 1',
    })

    const updated = updateRecurringTask(task.id, { title: 'New', priority: 'urgent' })
    expect(updated).not.toBeNull()
    expect(updated!.title).toBe('New')
    expect(updated!.priority).toBe('urgent')
  })

  test('updates cron expression and recomputes nextRun', () => {
    const task = createRecurringTask({
      userId: USER_ID,
      projectId: PROJECT_ID,
      title: 'Test',
      triggerType: 'cron',
      cronExpression: '0 9 * * 1',
    })
    const oldNextRun = task.nextRun

    const updated = updateRecurringTask(task.id, { cronExpression: '0 14 * * 5' })
    expect(updated).not.toBeNull()
    expect(updated!.nextRun).not.toBe(oldNextRun)
  })

  test('returns null for non-existent task', () => {
    const result = updateRecurringTask('non-existent', { title: 'X' })
    expect(result).toBeNull()
  })
})

describe('pauseRecurringTask', () => {
  test('disables the task', () => {
    const task = createRecurringTask({
      userId: USER_ID,
      projectId: PROJECT_ID,
      title: 'Test',
      triggerType: 'cron',
      cronExpression: '0 9 * * 1',
    })
    expect(task.enabled).toBe(true)

    const paused = pauseRecurringTask(task.id)
    expect(paused).not.toBeNull()
    expect(paused!.enabled).toBe(false)
  })
})

describe('resumeRecurringTask', () => {
  test('resumes and resets nextRun to future', () => {
    const task = createRecurringTask({
      userId: USER_ID,
      projectId: PROJECT_ID,
      title: 'Test',
      triggerType: 'cron',
      cronExpression: '0 9 * * 1',
    })
    pauseRecurringTask(task.id)

    const resumed = resumeRecurringTask(task.id, false)
    expect(resumed).not.toBeNull()
    expect(resumed!.enabled).toBe(true)
    expect(resumed!.nextRun).not.toBeNull()
    // nextRun should be in the future
    expect(new Date(resumed!.nextRun!).getTime()).toBeGreaterThan(Date.now())
  })

  test('returns null for non-existent task', () => {
    expect(resumeRecurringTask('non-existent', false)).toBeNull()
  })
})

describe('skipNextOccurrence', () => {
  test('advances nextRun past the current one', () => {
    const task = createRecurringTask({
      userId: USER_ID,
      projectId: PROJECT_ID,
      title: 'Test',
      triggerType: 'cron',
      cronExpression: '0 9 * * 1',
    })
    const originalNextRun = task.nextRun!

    const skipped = skipNextOccurrence(task.id)
    expect(skipped).not.toBeNull()
    expect(skipped!.nextRun).not.toBe(originalNextRun)
    expect(new Date(skipped!.nextRun!).getTime()).toBeGreaterThan(new Date(originalNextRun).getTime())
  })
})

describe('deleteRecurringTask', () => {
  test('deletes an existing task', () => {
    const task = createRecurringTask({
      userId: USER_ID,
      projectId: PROJECT_ID,
      title: 'Test',
      triggerType: 'cron',
      cronExpression: '0 9 * * 1',
    })

    expect(deleteRecurringTask(task.id)).toBe(true)
    expect(getRecurringTask(task.id)).toBeNull()
  })

  test('returns false for non-existent task', () => {
    expect(deleteRecurringTask('non-existent')).toBe(false)
  })

  test('task no longer appears in list after deletion', () => {
    const task = createRecurringTask({
      userId: USER_ID,
      projectId: PROJECT_ID,
      title: 'Test',
      triggerType: 'cron',
      cronExpression: '0 9 * * 1',
    })
    deleteRecurringTask(task.id)

    const tasks = listRecurringTasks(USER_ID)
    expect(tasks).toHaveLength(0)
  })
})

describe('getDueRecurringTasks', () => {
  test('returns tasks with nextRun in the past', () => {
    const task = createRecurringTask({
      userId: USER_ID,
      projectId: PROJECT_ID,
      title: 'Due',
      triggerType: 'cron',
      cronExpression: '0 9 * * 1',
    })

    // Manually set nextRun to the past
    testSqlite.run('UPDATE recurring_tasks SET next_run = ? WHERE id = ?', [
      new Date(Date.now() - 60000).toISOString(),
      task.id,
    ])

    const due = getDueRecurringTasks()
    expect(due.length).toBeGreaterThanOrEqual(1)
    expect(due.some((t) => t.id === task.id)).toBe(true)
  })

  test('does not return paused tasks', () => {
    const task = createRecurringTask({
      userId: USER_ID,
      projectId: PROJECT_ID,
      title: 'Paused',
      triggerType: 'cron',
      cronExpression: '0 9 * * 1',
    })
    pauseRecurringTask(task.id)

    // Manually set nextRun to the past
    testSqlite.run('UPDATE recurring_tasks SET next_run = ? WHERE id = ?', [
      new Date(Date.now() - 60000).toISOString(),
      task.id,
    ])

    const due = getDueRecurringTasks()
    expect(due.some((t) => t.id === task.id)).toBe(false)
  })
})

describe('markExecuted', () => {
  test('updates lastRun and recomputes nextRun', () => {
    const task = createRecurringTask({
      userId: USER_ID,
      projectId: PROJECT_ID,
      title: 'Test',
      triggerType: 'cron',
      cronExpression: '0 9 * * 1',
    })

    markExecuted(task.id)

    const updated = getRecurringTask(task.id)
    expect(updated).not.toBeNull()
    expect(updated!.lastRun).not.toBeNull()
    expect(updated!.nextRun).not.toBeNull()
  })
})
