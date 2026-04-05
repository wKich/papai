import { Database } from 'bun:sqlite'
import { describe, expect, test, beforeEach } from 'bun:test'

import { drizzle } from 'drizzle-orm/bun-sqlite'

import { _setDrizzleDb } from '../src/db/drizzle.js'
import * as schema from '../src/db/schema.js'
import {
  createRecurringTask,
  deleteRecurringTask,
  findTemplateByTaskId,
  getDueRecurringTasks,
  getRecurringTask,
  isCompletionStatus,
  listRecurringTasks,
  markExecuted,
  pauseRecurringTask,
  recordOccurrence,
  resumeRecurringTask,
  skipNextOccurrence,
  updateRecurringTask,
} from '../src/recurring.js'
import { mockLogger } from './utils/test-helpers.js'

const USER_ID = 'test-user-1'
const PROJECT_ID = 'project-1'

describe('recurring tasks', () => {
  let testDb: ReturnType<typeof drizzle<typeof schema>>
  let testSqlite: Database

  beforeEach(() => {
    mockLogger()
    testSqlite = new Database(':memory:')
    testSqlite.run('PRAGMA journal_mode=WAL')
    testSqlite.run('PRAGMA foreign_keys=ON')
    testDb = drizzle(testSqlite, { schema })
    _setDrizzleDb(testDb)

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

    // Create recurring_task_occurrences table
    testSqlite.run(`
    CREATE TABLE recurring_task_occurrences (
      id TEXT PRIMARY KEY,
      template_id TEXT NOT NULL,
      task_id TEXT NOT NULL,
      created_at TEXT DEFAULT (datetime('now')) NOT NULL
    )
  `)
    testSqlite.run('CREATE INDEX idx_recurring_occurrences_template ON recurring_task_occurrences(template_id)')
    testSqlite.run('CREATE INDEX idx_recurring_occurrences_task ON recurring_task_occurrences(task_id)')
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

      const result = resumeRecurringTask(task.id, false)
      expect(result).not.toBeNull()
      expect(result!.record.enabled).toBe(true)
      expect(result!.record.nextRun).not.toBeNull()
      // nextRun should be in the future
      expect(new Date(result!.record.nextRun!).getTime()).toBeGreaterThan(Date.now())
      expect(result!.missedDates).toEqual([])
    })

    test('returns missed dates when createMissed is true', () => {
      const task = createRecurringTask({
        userId: USER_ID,
        projectId: PROJECT_ID,
        title: 'Missed Test',
        triggerType: 'cron',
        cronExpression: '* * * * *',
      })
      pauseRecurringTask(task.id)
      // Set nextRun to 5 minutes ago so there are missed occurrences
      testSqlite.run('UPDATE recurring_tasks SET next_run = ? WHERE id = ?', [
        new Date(Date.now() - 5 * 60 * 1000).toISOString(),
        task.id,
      ])

      const result = resumeRecurringTask(task.id, true)
      expect(result).not.toBeNull()
      expect(result!.missedDates.length).toBeGreaterThanOrEqual(1)
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

    test('returns null for on_complete task (cannot skip non-cron task)', () => {
      // Create on_complete task (has no cronExpression, nextRun is null)
      const task = createRecurringTask({
        userId: USER_ID,
        projectId: PROJECT_ID,
        title: 'On-complete task',
        triggerType: 'on_complete',
      })

      const result = skipNextOccurrence(task.id)
      // Should return null — skip is not meaningful for on_complete tasks
      expect(result).toBeNull()
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

    test('finds enabled tasks when table uses INTEGER columns (migration schema)', () => {
      // Re-create table with INTEGER columns exactly as migration 009 creates them
      testSqlite.run('DROP TABLE IF EXISTS recurring_tasks')
      testSqlite.run('DROP INDEX IF EXISTS idx_recurring_tasks_user')
      testSqlite.run('DROP INDEX IF EXISTS idx_recurring_tasks_enabled_next')
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
        enabled INTEGER NOT NULL DEFAULT 1,
        catch_up INTEGER NOT NULL DEFAULT 0,
        last_run TEXT,
        next_run TEXT,
        created_at TEXT DEFAULT (datetime('now')) NOT NULL,
        updated_at TEXT DEFAULT (datetime('now')) NOT NULL
      )
    `)
      testSqlite.run('CREATE INDEX idx_recurring_tasks_user ON recurring_tasks(user_id)')
      testSqlite.run('CREATE INDEX idx_recurring_tasks_enabled_next ON recurring_tasks(enabled, next_run)')

      // Insert an enabled task with a past nextRun using raw SQL (INTEGER 1 for enabled)
      const pastTime = new Date(Date.now() - 60000).toISOString()
      testSqlite.run(
        `INSERT INTO recurring_tasks (id, user_id, project_id, title, trigger_type, enabled, catch_up, next_run, created_at, updated_at)
       VALUES ('migration-test-id', 'u1', 'p1', 'Migration Task', 'cron', 1, 0, ?, datetime('now'), datetime('now'))`,
        [pastTime],
      )

      const due = getDueRecurringTasks()
      expect(due.some((t) => t.id === 'migration-test-id')).toBe(true)
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

  describe('recordOccurrence', () => {
    test('records an occurrence linking template to task', () => {
      const task = createRecurringTask({
        userId: USER_ID,
        projectId: PROJECT_ID,
        title: 'Test',
        triggerType: 'cron',
        cronExpression: '0 9 * * 1',
      })

      recordOccurrence(task.id, 'external-task-123')

      const row = testSqlite
        .query<{ template_id: string; task_id: string }, [string]>(
          'SELECT template_id, task_id FROM recurring_task_occurrences WHERE task_id = ?',
        )
        .get('external-task-123')

      expect(row).not.toBeUndefined()
      expect(row!.template_id).toBe(task.id)
      expect(row!.task_id).toBe('external-task-123')
    })
  })

  describe('findTemplateByTaskId', () => {
    test('returns template when task_id matches an occurrence', () => {
      const task = createRecurringTask({
        userId: USER_ID,
        projectId: PROJECT_ID,
        title: 'Weekly Sync',
        triggerType: 'cron',
        cronExpression: '0 9 * * 1',
      })

      recordOccurrence(task.id, 'ext-task-1')

      const found = findTemplateByTaskId('ext-task-1')
      expect(found).not.toBeNull()
      expect(found!.id).toBe(task.id)
      expect(found!.title).toBe('Weekly Sync')
    })

    test('returns null when task_id has no occurrence', () => {
      const found = findTemplateByTaskId('nonexistent-task')
      expect(found).toBeNull()
    })
  })

  describe('isCompletionStatus', () => {
    test('matches done status', () => {
      expect(isCompletionStatus('done')).toBe(true)
      expect(isCompletionStatus('Done')).toBe(true)
      expect(isCompletionStatus('DONE')).toBe(true)
    })

    test('matches completed status', () => {
      expect(isCompletionStatus('completed')).toBe(true)
      expect(isCompletionStatus('Completed')).toBe(true)
    })

    test('matches closed status', () => {
      expect(isCompletionStatus('closed')).toBe(true)
    })

    test('matches resolved status', () => {
      expect(isCompletionStatus('resolved')).toBe(true)
    })

    test('does not match non-completion statuses', () => {
      expect(isCompletionStatus('in-progress')).toBe(false)
      expect(isCompletionStatus('todo')).toBe(false)
      expect(isCompletionStatus('to-do')).toBe(false)
      expect(isCompletionStatus('in-review')).toBe(false)
    })
  })
})
