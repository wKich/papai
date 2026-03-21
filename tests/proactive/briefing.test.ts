import { beforeEach, describe, expect, mock, test } from 'bun:test'

import { mockLogger, setupTestDb, mockDrizzle } from '../utils/test-helpers.js'

mockLogger()
mockDrizzle()

// Mock getConfig with configurable values
const configStore = new Map<string, string>()

void mock.module('../../src/config.js', () => ({
  getConfig: (_userId: string, key: string): string | null => configStore.get(key) ?? null,
  isConfigKey: (): boolean => true,
  getAllConfig: (): Record<string, string> => ({}),
  setConfig: (): void => {},
  maskValue: (_k: string, v: string): string => v,
}))

import {
  buildSections,
  formatFull,
  formatShort,
  suggestActions,
  generate,
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
    configStore.clear()
    configStore.set('timezone', 'UTC')
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
      await generate('user1', provider, 'full')

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
      configStore.set('briefing_time', '08:00')

      const provider = makeMockProvider([])
      // Generate a briefing first (sets last_briefing_date to today)
      await generate('user1', provider, 'full')

      const result = await getMissedBriefing('user1', provider)
      expect(result).toBeNull()
    })

    test('returns catch-up string when briefing time has passed', async () => {
      // Set briefing time to 00:01 (always in the past since tests run after midnight)
      configStore.set('briefing_time', '00:01')

      const provider = makeMockProvider([makeTask({ id: 't1', dueDate: today(), status: 'todo' })])

      const result = await getMissedBriefing('user1', provider)
      expect(result).not.toBeNull()
      expect(result).toContain('Catch-up')
      expect(result).toContain('missed 00:01 briefing')
    })

    test('catch-up string includes (Catch-up) header', async () => {
      configStore.set('briefing_time', '00:01')

      const provider = makeMockProvider([])
      const result = await getMissedBriefing('user1', provider)

      if (result !== null) {
        expect(result).toContain('**(Catch-up')
      }
    })
  })
})
