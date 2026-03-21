import { Database } from 'bun:sqlite'
import { mock, describe, expect, test, beforeEach } from 'bun:test'

import { drizzle } from 'drizzle-orm/bun-sqlite'

import * as schema from '../src/db/schema.js'
import { mockLogger } from './utils/test-helpers.js'

mockLogger()

// Mutable state for controlling provider behavior
let createTaskCallCount = 0
let resolveCreateTask: (() => void) | null = null

type MockTask = { id: string; title: string; projectId: string; status: string; priority: string }
type MockProvider = { capabilities: Set<string>; createTask: () => Promise<MockTask> }

void mock.module('../src/providers/registry.js', () => ({
  createProvider: (): MockProvider => ({
    capabilities: new Set<string>(),
    createTask: (): Promise<MockTask> =>
      new Promise<MockTask>((resolve) => {
        createTaskCallCount++
        resolveCreateTask = (): void =>
          resolve({ id: 'new-task-1', title: 'Test', projectId: 'p1', status: 'todo', priority: 'medium' })
      }),
  }),
}))

// In-memory test database
let testSqlite: Database
let testDb: ReturnType<typeof drizzle<typeof schema>>

void mock.module('../src/db/drizzle.js', () => ({
  getDrizzleDb: (): ReturnType<typeof drizzle<typeof schema>> => testDb,
  closeDrizzleDb: (): void => {},
  _resetDrizzleDb: (): void => {},
  _setDrizzleDb: (): void => {},
}))

// Set TASK_PROVIDER before importing scheduler
process.env['TASK_PROVIDER'] = 'kaneo'
process.env['KANEO_CLIENT_URL'] = 'http://localhost:11337'

import { setCachedConfig } from '../src/cache.js'
import { createRecurringTask } from '../src/recurring.js'
import { tick } from '../src/scheduler.js'
import { setKaneoWorkspace } from '../src/users.js'
import { clearUserCache } from './utils/test-cache.js'

const USER_ID = 'user-1'

beforeEach(() => {
  createTaskCallCount = 0
  resolveCreateTask = null

  // Set up fresh in-memory SQLite with recurring_tasks table
  testSqlite = new Database(':memory:')
  testDb = drizzle(testSqlite, { schema })
  testSqlite.run(`
    CREATE TABLE IF NOT EXISTS recurring_tasks (
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
  testSqlite.run('CREATE INDEX IF NOT EXISTS idx_recurring_tasks_user ON recurring_tasks(user_id)')
  testSqlite.run('CREATE INDEX IF NOT EXISTS idx_recurring_tasks_enabled_next ON recurring_tasks(enabled, next_run)')

  // Clear user cache and seed config for the test user
  clearUserCache(USER_ID)
  setCachedConfig(USER_ID, 'kaneo_apikey', 'test-api-key')
  setKaneoWorkspace(USER_ID, 'workspace-1')

  // Create a due recurring task directly in the test DB
  createRecurringTask({
    userId: USER_ID,
    projectId: 'proj-1',
    title: 'Recurring Test',
    triggerType: 'cron',
    cronExpression: '0 9 * * 1',
    timezone: 'UTC',
    catchUp: false,
  })

  // Manually set nextRun to the past so the task is due
  testSqlite.run(`UPDATE recurring_tasks SET next_run = datetime('now', '-1 minute') WHERE user_id = '${USER_ID}'`)
})

describe('scheduler tick in-flight guard', () => {
  test('second concurrent tick is skipped while first is still running', async () => {
    // Start first tick (does NOT await — it will be pending waiting for createTask to resolve)
    const firstTick = tick()

    // Start second tick immediately while first is still in-flight
    const secondTick = tick()

    // Yield to microtask queue so the first tick can reach createTask
    await Promise.resolve()
    await Promise.resolve()

    // Resolve the provider's createTask promise
    if (resolveCreateTask !== null) resolveCreateTask()

    // Await both
    await firstTick
    await secondTick

    // createTask should have been called exactly once — second tick was skipped
    expect(createTaskCallCount).toBe(1)
  })
})
