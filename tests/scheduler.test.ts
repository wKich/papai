import { Database } from 'bun:sqlite'
import { mock, describe, expect, test, beforeEach, afterEach, afterAll } from 'bun:test'

import { drizzle } from 'drizzle-orm/bun-sqlite'

import * as schema from '../src/db/schema.js'
import { mockLogger } from './utils/test-helpers.js'

mockLogger()

// This file mocks providers/registry.js and db/drizzle.js.
// mock.restore() in afterAll prevents these from leaking into other test files.
afterAll(() => {
  mock.restore()
})

// ---- Mutable mock state ----

type MockTask = { id: string; title: string; projectId: string; status: string; priority: string }

let createTaskImpl: (...args: unknown[]) => Promise<MockTask>
let addTaskLabelImpl: (taskId: string, labelId: string) => Promise<{ taskId: string; labelId: string }>
let mockCapabilities: Set<string>

let resolveCreateTask: (() => void) | null = null
let createTaskCallCount = 0

const defaultCreateTask = (): Promise<MockTask> =>
  Promise.resolve({
    id: 'new-task-1',
    title: 'Recurring Test',
    projectId: 'proj-1',
    status: 'todo',
    priority: 'medium',
  })

void mock.module('../src/providers/registry.js', () => ({
  createProvider: (): {
    capabilities: Set<string>
    createTask: (...args: unknown[]) => Promise<MockTask>
    addTaskLabel?: (taskId: string, labelId: string) => Promise<{ taskId: string; labelId: string }>
  } => ({
    capabilities: mockCapabilities,
    createTask: (...args: unknown[]): Promise<MockTask> => {
      createTaskCallCount++
      return createTaskImpl(...args)
    },
    addTaskLabel: (taskId: string, labelId: string): Promise<{ taskId: string; labelId: string }> =>
      addTaskLabelImpl(taskId, labelId),
  }),
}))

// ---- Chat provider mock for notifications ----

let sendMessageCalls: Array<{ userId: string; text: string }> = []
let sendMessageImpl: (userId: string, text: string) => Promise<void> = () => Promise.resolve()

const mockChatProvider = {
  name: 'mock',
  registerCommand: (): void => {},
  onMessage: (): void => {},
  sendMessage: (userId: string, text: string): Promise<void> => {
    sendMessageCalls.push({ userId, text })
    return sendMessageImpl(userId, text)
  },
  start: (): Promise<void> => Promise.resolve(),
  stop: (): Promise<void> => Promise.resolve(),
}

// ---- In-memory test database ----

let testSqlite: Database
let testDb: ReturnType<typeof drizzle<typeof schema>>

void mock.module('../src/db/drizzle.js', () => ({
  getDrizzleDb: (): ReturnType<typeof drizzle<typeof schema>> => testDb,
  closeDrizzleDb: (): void => {},
  _resetDrizzleDb: (): void => {},
  _setDrizzleDb: (): void => {},
}))

process.env['TASK_PROVIDER'] = 'kaneo'
process.env['KANEO_CLIENT_URL'] = 'http://localhost:11337'

import { setCachedConfig } from '../src/cache.js'
import { createRecurringTask, getDueRecurringTasks } from '../src/recurring.js'
import { tick, createMissedTasks, startScheduler, stopScheduler } from '../src/scheduler.js'
import { setKaneoWorkspace } from '../src/users.js'
import { clearUserCache } from './utils/test-cache.js'

const USER_ID = 'user-1'

const setupDb = (): void => {
  testSqlite = new Database(':memory:')
  testDb = drizzle(testSqlite, { schema })
  testSqlite.run(`
    CREATE TABLE IF NOT EXISTS recurring_tasks (
      id TEXT PRIMARY KEY, user_id TEXT NOT NULL, project_id TEXT NOT NULL, title TEXT NOT NULL,
      description TEXT, priority TEXT, status TEXT, assignee TEXT, labels TEXT,
      trigger_type TEXT NOT NULL DEFAULT 'cron', cron_expression TEXT,
      timezone TEXT NOT NULL DEFAULT 'UTC', enabled TEXT NOT NULL DEFAULT '1',
      catch_up TEXT NOT NULL DEFAULT '0', last_run TEXT, next_run TEXT,
      created_at TEXT DEFAULT (datetime('now')) NOT NULL, updated_at TEXT DEFAULT (datetime('now')) NOT NULL
    )
  `)
  testSqlite.run('CREATE INDEX IF NOT EXISTS idx_recurring_tasks_user ON recurring_tasks(user_id)')
  testSqlite.run('CREATE INDEX IF NOT EXISTS idx_recurring_tasks_enabled_next ON recurring_tasks(enabled, next_run)')
  testSqlite.run(`
    CREATE TABLE IF NOT EXISTS recurring_task_occurrences (
      id TEXT PRIMARY KEY, template_id TEXT NOT NULL, task_id TEXT NOT NULL,
      created_at TEXT DEFAULT (datetime('now')) NOT NULL, deleted_at TEXT
    )
  `)
}

const seedUser = (userId: string = USER_ID): void => {
  clearUserCache(userId)
  setCachedConfig(userId, 'kaneo_apikey', 'test-api-key')
  setKaneoWorkspace(userId, 'workspace-1')
}

const createDueTask = (
  overrides: Partial<{
    userId: string
    projectId: string
    title: string
    labels: string[]
    priority: string
    status: string
  }> = {},
): string => {
  const record = createRecurringTask({
    userId: overrides.userId ?? USER_ID,
    projectId: overrides.projectId ?? 'proj-1',
    title: overrides.title ?? 'Recurring Test',
    triggerType: 'cron',
    cronExpression: '0 9 * * 1',
    timezone: 'UTC',
    catchUp: false,
    labels: overrides.labels,
    priority: overrides.priority,
    status: overrides.status,
  })
  testSqlite.run(`UPDATE recurring_tasks SET next_run = datetime('now', '-1 minute') WHERE id = '${record.id}'`)
  return record.id
}

/**
 * Call tick() and wait for it to fully complete, including the finally block.
 * Due to a bun runtime quirk, activeTickPromise may not be cleared by the time
 * await tick() returns. Calling tick() a second time forces the first one to be
 * recognized as done and processes any remaining work.
 */
const awaitTick = async (): Promise<void> => {
  await tick()
}

beforeEach(() => {
  createTaskCallCount = 0
  resolveCreateTask = null
  createTaskImpl = defaultCreateTask
  addTaskLabelImpl = (taskId: string, labelId: string): Promise<{ taskId: string; labelId: string }> =>
    Promise.resolve({ taskId, labelId })
  mockCapabilities = new Set<string>()
  sendMessageCalls = []
  sendMessageImpl = (): Promise<void> => Promise.resolve()
  setupDb()
  seedUser()
})

afterEach(() => {
  stopScheduler()
})

describe('scheduler tick in-flight guard', () => {
  test('second concurrent tick is skipped while first is still running', async () => {
    createDueTask()

    createTaskImpl = (): Promise<MockTask> =>
      new Promise<MockTask>((resolve) => {
        resolveCreateTask = (): void =>
          resolve({ id: 'new-task-1', title: 'Test', projectId: 'p1', status: 'todo', priority: 'medium' })
      })

    const firstTick = tick()
    const secondTick = tick()

    await Promise.resolve()
    await Promise.resolve()

    if (resolveCreateTask !== null) resolveCreateTask()

    await firstTick
    await secondTick

    expect(createTaskCallCount).toBe(1)
  })
})

describe('tick() — happy path', () => {
  test('tick() with one due task creates task instance', async () => {
    createDueTask()
    await awaitTick()
    expect(createTaskCallCount).toBe(1)
  })

  test('tick() marks task as executed after creation', async () => {
    const taskId = createDueTask()
    await awaitTick()
    const row = testSqlite
      .query<{ last_run: string | null; next_run: string | null }, []>(
        `SELECT last_run, next_run FROM recurring_tasks WHERE id = '${taskId}'`,
      )
      .get()
    expect(row).toBeDefined()
    expect(row!.last_run).not.toBeNull()
    expect(new Date(row!.next_run!).getTime()).toBeGreaterThan(new Date(row!.last_run!).getTime())
  })

  test('tick() records occurrence linking template to created task', async () => {
    createDueTask()
    await awaitTick()
    const occurrences = testSqlite
      .query<{ template_id: string; task_id: string }, []>(
        'SELECT template_id, task_id FROM recurring_task_occurrences',
      )
      .all()
    expect(occurrences).toHaveLength(1)
    expect(occurrences[0]!.task_id).toBe('new-task-1')
  })

  test('tick() with no due tasks makes no provider calls', () => {
    createRecurringTask({
      userId: USER_ID,
      projectId: 'proj-1',
      title: 'Future Task',
      triggerType: 'cron',
      cronExpression: '0 9 * * 1',
      timezone: 'UTC',
      catchUp: false,
    })
    const dueTasks = getDueRecurringTasks()
    expect(dueTasks).toHaveLength(0)
    expect(createTaskCallCount).toBe(0)
  })
})

describe('tick() — error resilience', () => {
  test('tick() when provider createTask throws does not crash, task NOT marked executed', async () => {
    const taskId = createDueTask()
    createTaskImpl = (): Promise<MockTask> => Promise.reject(new Error('API down'))
    await awaitTick()
    const row = testSqlite
      .query<{ last_run: string | null }, []>(`SELECT last_run FROM recurring_tasks WHERE id = '${taskId}'`)
      .get()
    expect(row!.last_run).toBeNull()
  })

  test('tick() continues processing remaining tasks after one fails', async () => {
    const taskId1 = createDueTask({ title: 'Task 1' })
    const USER_2 = 'user-2'
    seedUser(USER_2)
    const taskId2 = createDueTask({ userId: USER_2, title: 'Task 2' })

    let callIdx = 0
    createTaskImpl = (): Promise<MockTask> => {
      callIdx++
      if (callIdx === 1) return Promise.reject(new Error('API down'))
      return Promise.resolve({
        id: 'new-task-2',
        title: 'Task 2',
        projectId: 'proj-1',
        status: 'todo',
        priority: 'medium',
      })
    }

    await awaitTick()

    const row1 = testSqlite
      .query<{ last_run: string | null }, []>(`SELECT last_run FROM recurring_tasks WHERE id = '${taskId1}'`)
      .get()
    expect(row1!.last_run).toBeNull()

    const row2 = testSqlite
      .query<{ last_run: string | null }, []>(`SELECT last_run FROM recurring_tasks WHERE id = '${taskId2}'`)
      .get()
    expect(row2!.last_run).not.toBeNull()

    const occurrences = testSqlite.query<{ id: string }, []>('SELECT id FROM recurring_task_occurrences').all()
    expect(occurrences).toHaveLength(1)
  })
})

describe('tick() — label application', () => {
  test('tick() applies labels when provider supports labels.assign', async () => {
    mockCapabilities = new Set<string>(['labels.assign'])
    const addTaskLabelCalls: Array<{ taskId: string; labelId: string }> = []
    addTaskLabelImpl = (taskId: string, labelId: string): Promise<{ taskId: string; labelId: string }> => {
      addTaskLabelCalls.push({ taskId, labelId })
      return Promise.resolve({ taskId, labelId })
    }
    createDueTask({ labels: ['label-1', 'label-2'] })
    await awaitTick()
    expect(addTaskLabelCalls).toHaveLength(2)
    expect(addTaskLabelCalls[0]!.labelId).toBe('label-1')
    expect(addTaskLabelCalls[1]!.labelId).toBe('label-2')
  })

  test('tick() skips label application when provider lacks labels.assign', async () => {
    const addTaskLabelCalls: Array<{ taskId: string; labelId: string }> = []
    addTaskLabelImpl = (taskId: string, labelId: string): Promise<{ taskId: string; labelId: string }> => {
      addTaskLabelCalls.push({ taskId, labelId })
      return Promise.resolve({ taskId, labelId })
    }
    createDueTask({ labels: ['label-1', 'label-2'] })
    await awaitTick()
    expect(addTaskLabelCalls).toHaveLength(0)
  })
})

describe('tick() — user notification', () => {
  test('tick() notifies user after task creation', async () => {
    createDueTask()
    startScheduler(mockChatProvider)
    // startScheduler calls tick() immediately, which processes the due task
    await Bun.sleep(50)
    expect(sendMessageCalls.length).toBeGreaterThanOrEqual(1)
    expect(sendMessageCalls[0]!.userId).toBe(USER_ID)
    expect(sendMessageCalls[0]!.text).toContain('Recurring Test')
  })

  test('tick() continues when notifyUser throws', async () => {
    sendMessageImpl = (): Promise<void> => Promise.reject(new Error('notification failed'))
    const taskId = createDueTask()
    startScheduler(mockChatProvider)
    await Bun.sleep(50)
    const row = testSqlite
      .query<{ last_run: string | null }, []>(`SELECT last_run FROM recurring_tasks WHERE id = '${taskId}'`)
      .get()
    expect(row!.last_run).not.toBeNull()
  })
})

describe('tick() — provider build failure', () => {
  test('tick() when buildProviderForUser returns null skips the task', async () => {
    clearUserCache(USER_ID)
    createDueTask()
    await awaitTick()
    expect(createTaskCallCount).toBe(0)
    const row = testSqlite
      .query<{ last_run: string | null }, []>(`SELECT last_run FROM recurring_tasks WHERE user_id = '${USER_ID}'`)
      .get()
    expect(row!.last_run).toBeNull()
  })
})

describe('createMissedTasks', () => {
  test('createMissedTasks with 3 missed dates creates 3 tasks', async () => {
    const taskId = createDueTask()
    const result = await createMissedTasks(taskId, ['2026-03-02', '2026-03-09', '2026-03-16'])
    expect(result).toBe(3)
    expect(createTaskCallCount).toBe(3)
    const occurrences = testSqlite.query<{ id: string }, []>('SELECT id FROM recurring_task_occurrences').all()
    expect(occurrences).toHaveLength(3)
  })

  test('createMissedTasks where one creation fails returns partial count', async () => {
    const taskId = createDueTask()
    let callIdx = 0
    createTaskImpl = (): Promise<MockTask> => {
      callIdx++
      if (callIdx === 2) return Promise.reject(new Error('API down'))
      return Promise.resolve({
        id: `new-task-${callIdx}`,
        title: 'Missed',
        projectId: 'proj-1',
        status: 'todo',
        priority: 'medium',
      })
    }
    const result = await createMissedTasks(taskId, ['2026-03-02', '2026-03-09', '2026-03-16'])
    expect(result).toBe(2)
  })

  test('createMissedTasks with empty missedDates returns 0', async () => {
    const taskId = createDueTask()
    const result = await createMissedTasks(taskId, [])
    expect(result).toBe(0)
    expect(createTaskCallCount).toBe(0)
  })

  test('createMissedTasks with non-existent recurring task ID returns 0', async () => {
    const result = await createMissedTasks('non-existent-id', ['2026-03-02'])
    expect(result).toBe(0)
    expect(createTaskCallCount).toBe(0)
  })
})

describe('startScheduler / stopScheduler', () => {
  test('startScheduler double-call does not error', () => {
    startScheduler(mockChatProvider)
    expect(() => startScheduler(mockChatProvider)).not.toThrow()
  })

  test('stopScheduler clears state and disables notifications', async () => {
    startScheduler(mockChatProvider)
    stopScheduler()
    createDueTask()
    await awaitTick()
    expect(sendMessageCalls).toHaveLength(0)
  })
})
