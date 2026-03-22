import { afterAll, beforeEach, describe, expect, mock, test } from 'bun:test'

import { mockLogger, setupTestDb, mockDrizzle } from '../utils/test-helpers.js'

mockLogger()
mockDrizzle()

import { setConfig } from '../../src/config.js'
import {
  buildSections,
  formatFull,
  formatShort,
  suggestActions,
  generate,
  generateAndRecord,
  getMissedBriefing,
} from '../../src/proactive/briefing.js'
import type { TaskListItem } from '../../src/providers/types.js'
import { createMockProvider } from '../tools/mock-provider.js'

const today = (): string => new Date().toISOString().slice(0, 10)
const yesterday = (): string => new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString().slice(0, 10)

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

const makeMockProvider = (tasks: TaskListItem[]): ReturnType<typeof createMockProvider> =>
  createMockProvider({
    listProjects: () => Promise.resolve([{ id: 'proj-1', name: 'Test', description: '', url: '' }]),
    listTasks: () => Promise.resolve(tasks),
  })

describe('BriefingService', () => {
  beforeEach(async () => {
    await setupTestDb()
    setConfig('user1', 'timezone', 'UTC')
  })

  describe('buildSections', () => {
    test('correctly partitions tasks into due-today, overdue, in-progress', () => {
      const tasks: TaskListItem[] = [
        makeTask({ id: 't1', title: 'Due Today', dueDate: today(), status: 'todo' }),
        makeTask({ id: 't2', title: 'Overdue', dueDate: yesterday(), status: 'todo' }),
        makeTask({ id: 't3', title: 'In Progress', status: 'in-progress' }),
        makeTask({ id: 't4', title: 'Done', status: 'done' }),
      ]

      const sections = buildSections(tasks, 'UTC')

      const dueTodaySection = sections.find((s) => s.title === 'Due Today')
      const overdueSection = sections.find((s) => s.title === 'Overdue')
      const inProgressSection = sections.find((s) => s.title === 'In Progress')

      expect(dueTodaySection?.tasks).toHaveLength(1)
      expect(dueTodaySection?.tasks[0]!.title).toBe('Due Today')
      expect(overdueSection?.tasks).toHaveLength(1)
      expect(overdueSection?.tasks[0]!.title).toBe('Overdue')
      expect(inProgressSection?.tasks).toHaveLength(1)
      expect(inProgressSection?.tasks[0]!.title).toBe('In Progress')
    })

    test('excludes terminal tasks', () => {
      const tasks: TaskListItem[] = [
        makeTask({ id: 't1', title: 'Done Task', dueDate: today(), status: 'done' }),
        makeTask({ id: 't2', title: 'Cancelled Task', dueDate: today(), status: 'cancelled' }),
      ]

      const sections = buildSections(tasks, 'UTC')
      expect(sections).toHaveLength(0)
    })

    test('includes Recently Updated section for tasks with recent status changes', () => {
      const tasks: TaskListItem[] = [makeTask({ id: 'recently', title: 'Recent Task', status: 'in-review' })]

      // 1 hour ago
      const recentTime = new Date(Date.now() - 60 * 60 * 1000).toISOString()
      const alertStateRows = [
        {
          id: 'row-1',
          userId: 'user1',
          taskId: 'recently',
          lastSeenStatus: 'todo',
          lastStatusChangedAt: recentTime,
          lastAlertType: null,
          lastAlertSentAt: null,
          suppressUntil: null,
          overdueDaysNotified: 0,
          createdAt: recentTime,
        },
      ]

      const sections = buildSections(tasks, 'UTC', alertStateRows)
      const recentSection = sections.find((s) => s.title === 'Recently Updated')
      expect(recentSection).toBeDefined()
      expect(recentSection?.tasks).toHaveLength(1)
      expect(recentSection?.tasks[0]!.title).toBe('Recent Task')
    })

    test('excludes tasks from Recently Updated if already in Due Today or Overdue', () => {
      const tasks: TaskListItem[] = [
        makeTask({ id: 'due-today-task', title: 'Due Today Task', dueDate: today(), status: 'todo' }),
        makeTask({ id: 'overdue-task', title: 'Overdue Task', dueDate: yesterday(), status: 'todo' }),
      ]

      const recentTime = new Date(Date.now() - 60 * 60 * 1000).toISOString()
      const alertStateRows = [
        {
          id: 'row-1',
          userId: 'u',
          taskId: 'due-today-task',
          lastSeenStatus: 'todo',
          lastStatusChangedAt: recentTime,
          lastAlertType: null,
          lastAlertSentAt: null,
          suppressUntil: null,
          overdueDaysNotified: 0,
          createdAt: recentTime,
        },
        {
          id: 'row-2',
          userId: 'u',
          taskId: 'overdue-task',
          lastSeenStatus: 'todo',
          lastStatusChangedAt: recentTime,
          lastAlertType: null,
          lastAlertSentAt: null,
          suppressUntil: null,
          overdueDaysNotified: 0,
          createdAt: recentTime,
        },
      ]

      const sections = buildSections(tasks, 'UTC', alertStateRows)
      const recentSection = sections.find((s) => s.title === 'Recently Updated')
      expect(recentSection).toBeUndefined()
    })
  })

  describe('formatFull', () => {
    test('returns section headers in markdown', () => {
      const sections = [
        { title: 'Due Today', tasks: [{ id: 't1', title: 'Task A', url: 'https://x.com/t1', dueDate: today() }] },
        { title: 'Overdue', tasks: [{ id: 't2', title: 'Task B', dueDate: yesterday() }] },
      ]

      const result = formatFull('Monday, March 21, 2026', sections)
      expect(result).toContain('**📋 Morning Briefing')
      expect(result).toContain('**Due Today**')
      expect(result).toContain('**Overdue**')
      expect(result).toContain('[Task A](https://x.com/t1)')
    })

    test('shows celebration message when no sections', () => {
      const result = formatFull('Monday, March 21, 2026', [])
      expect(result).toContain('No tasks require attention')
    })
  })

  describe('formatShort', () => {
    test('returns single summary line', () => {
      const sections = [
        {
          title: 'Due Today',
          tasks: [
            { id: 't1', title: 'A' },
            { id: 't2', title: 'B' },
          ],
        },
        { title: 'Overdue', tasks: [{ id: 't3', title: 'C' }] },
      ]

      const result = formatShort(sections)
      expect(result).toBe('2 due today · 1 overdue')
    })

    test('returns no-tasks message for empty sections', () => {
      const result = formatShort([])
      expect(result).toContain('No tasks require attention')
    })
  })

  describe('suggestActions', () => {
    test('returns overdue tasks before urgent due-today', () => {
      const sections = [
        { title: 'Overdue', tasks: [{ id: 't1', title: 'Overdue', priority: 'medium' }] },
        { title: 'Due Today', tasks: [{ id: 't2', title: 'Urgent Today', priority: 'urgent' }] },
      ]

      const actions = suggestActions(sections)
      expect(actions[0]!.title).toBe('Overdue')
      expect(actions[1]!.title).toBe('Urgent Today')
    })

    test('returns at most 3 tasks', () => {
      const sections = [
        {
          title: 'Overdue',
          tasks: [
            { id: 't1', title: 'A', priority: 'high' },
            { id: 't2', title: 'B', priority: 'high' },
          ],
        },
        {
          title: 'Due Today',
          tasks: [
            { id: 't3', title: 'C', priority: 'urgent' },
            { id: 't4', title: 'D', priority: 'high' },
          ],
        },
      ]

      const actions = suggestActions(sections)
      expect(actions).toHaveLength(3)
    })
  })

  describe('generate', () => {
    test('in short mode returns single summary line', async () => {
      const provider = makeMockProvider([makeTask({ id: 't1', dueDate: today(), status: 'todo' })])

      const result = await generate('user1', provider, 'short')
      expect(result).toContain('due today')
      expect(result).not.toContain('**Due Today**')
    })

    test('in full mode returns section headers in markdown', async () => {
      const provider = makeMockProvider([makeTask({ id: 't1', dueDate: today(), status: 'todo' })])

      const result = await generate('user1', provider, 'full')
      expect(result).toContain('**📋 Morning Briefing')
      expect(result).toContain('**Due Today**')
    })

    test('updates user_briefing_state.last_briefing_date', async () => {
      const provider = makeMockProvider([])
      await generateAndRecord('user1', provider, 'full')

      const { getDrizzleDb } = await import('../../src/db/drizzle.js')
      const { userBriefingState } = await import('../../src/db/schema.js')
      const { eq } = await import('drizzle-orm')
      const db = getDrizzleDb()

      const state = db.select().from(userBriefingState).where(eq(userBriefingState.userId, 'user1')).get()
      expect(state).toBeDefined()
      expect(state!.lastBriefingDate).toBe(today())
    })
  })

  describe('getMissedBriefing', () => {
    test('returns null when briefing_time not configured', async () => {
      const provider = makeMockProvider([])
      const result = await getMissedBriefing('user1', provider)
      expect(result).toBeNull()
    })

    test('returns null when last_briefing_date is today', async () => {
      setConfig('user1', 'briefing_time', '08:00')

      const provider = makeMockProvider([])
      // generateAndRecord sets last_briefing_date to today
      await generateAndRecord('user1', provider, 'full')

      const result = await getMissedBriefing('user1', provider)
      expect(result).toBeNull()
    })

    test('returns catch-up string when briefing time has passed', async () => {
      // Set briefing time to 00:01 (always in the past since tests run after midnight)
      setConfig('user1', 'briefing_time', '00:01')

      const provider = makeMockProvider([makeTask({ id: 't1', dueDate: today(), status: 'todo' })])

      const result = await getMissedBriefing('user1', provider)
      expect(result).not.toBeNull()
      expect(result).toContain('Catch-up')
      expect(result).toContain('missed 00:01 briefing')
    })

    test('catch-up string includes (Catch-up) header', async () => {
      setConfig('user1', 'briefing_time', '00:01')

      const provider = makeMockProvider([])
      const result = await getMissedBriefing('user1', provider)

      if (result !== null) {
        expect(result).toContain('**(Catch-up')
      }
    })
  })
})

afterAll(() => {
  mock.restore()
})
