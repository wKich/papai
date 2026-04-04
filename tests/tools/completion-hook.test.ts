import { beforeEach, describe, expect, mock, test } from 'bun:test'

import type { RecurringTaskRecord } from '../../src/types/recurring.js'
import { mockLogger } from '../utils/test-helpers.js'
import { createMockProvider } from './mock-provider.js'

const TEMPLATE_ID = 'template-1'
const PROJECT_ID = 'project-1'

const makeTemplate = (overrides: Partial<RecurringTaskRecord> = {}): RecurringTaskRecord => ({
  id: TEMPLATE_ID,
  userId: 'user-1',
  projectId: PROJECT_ID,
  title: 'Deploy review',
  description: null,
  priority: 'high',
  status: null,
  assignee: 'alice',
  labels: ['label-1'],
  triggerType: 'on_complete',
  cronExpression: null,
  timezone: 'UTC',
  enabled: true,
  catchUp: false,
  lastRun: null,
  nextRun: null,
  createdAt: new Date().toISOString(),
  updatedAt: new Date().toISOString(),
  ...overrides,
})

describe('completionHook', () => {
  // Mutable state for controlling recurring.js behavior
  let findTemplateByTaskIdResult: RecurringTaskRecord | null = null
  let recordOccurrenceCalls: Array<{ templateId: string; taskId: string }> = []
  let markExecutedCalls: string[] = []

  beforeEach(() => {
    mockLogger()

    findTemplateByTaskIdResult = null
    recordOccurrenceCalls = []
    markExecutedCalls = []

    void mock.module('../../src/recurring.js', () => ({
      findTemplateByTaskId: (_taskId: string): RecurringTaskRecord | null => findTemplateByTaskIdResult,
      isCompletionStatus: (status: string): boolean => {
        const lower = status.toLowerCase()
        return ['done', 'completed', 'closed', 'resolved'].some((s) => lower.includes(s))
      },
      recordOccurrence: (templateId: string, taskId: string): void => {
        recordOccurrenceCalls.push({ templateId, taskId })
      },
      markExecuted: (id: string): void => {
        markExecutedCalls.push(id)
      },
      COMPLETION_STATUSES: ['done', 'completed', 'closed', 'resolved'],
      createRecurringTask: (): null => null,
      getRecurringTask: (): null => null,
      listRecurringTasks: (): RecurringTaskRecord[] => [],
      updateRecurringTask: (): null => null,
      pauseRecurringTask: (): null => null,
      resumeRecurringTask: (): null => null,
      skipNextOccurrence: (): null => null,
      deleteRecurringTask: (): boolean => false,
      getDueRecurringTasks: (): RecurringTaskRecord[] => [],
    }))
  })

  test('fires when status transitions to done and on_complete template exists', async () => {
    const { completionHook } = await import('../../src/tools/completion-hook.js')
    const createTask = mock(() =>
      Promise.resolve({
        id: 'new-task-1',
        title: 'Deploy review',
        status: 'todo',
        url: 'https://test.com/task/new-1',
      }),
    )
    const provider = createMockProvider({ createTask })

    findTemplateByTaskIdResult = makeTemplate()

    await completionHook('completed-task-1', 'done', provider)

    expect(createTask).toHaveBeenCalledTimes(1)
    const calls = createTask.mock.calls
    if (calls.length === 0) throw new Error('Expected createTask to be called')
    const firstArg: unknown = calls[0]
    expect(firstArg).toMatchObject([
      {
        projectId: PROJECT_ID,
        title: 'Deploy review',
        priority: 'high',
        assignee: 'alice',
      },
    ])

    // Should have recorded the new occurrence
    expect(recordOccurrenceCalls).toHaveLength(1)
    expect(recordOccurrenceCalls[0]).toEqual({ templateId: TEMPLATE_ID, taskId: 'new-task-1' })

    // Should have marked the template as executed
    expect(markExecutedCalls).toEqual([TEMPLATE_ID])
  })

  test('does not fire when no matching template exists', async () => {
    const { completionHook } = await import('../../src/tools/completion-hook.js')
    const createTask = mock(() => Promise.resolve({ id: 'x', title: 'x', status: 'todo', url: 'https://test.com' }))
    const provider = createMockProvider({ createTask })

    findTemplateByTaskIdResult = null

    await completionHook('unknown-task', 'done', provider)

    expect(createTask).not.toHaveBeenCalled()
    expect(recordOccurrenceCalls).toHaveLength(0)
  })

  test('does not fire for non-completion statuses', async () => {
    const { completionHook } = await import('../../src/tools/completion-hook.js')
    const createTask = mock(() => Promise.resolve({ id: 'x', title: 'x', status: 'todo', url: 'https://test.com' }))
    const provider = createMockProvider({ createTask })

    findTemplateByTaskIdResult = makeTemplate()

    await completionHook('task-1', 'in-progress', provider)

    expect(createTask).not.toHaveBeenCalled()
  })

  test('does not fire for cron-based templates', async () => {
    const { completionHook } = await import('../../src/tools/completion-hook.js')
    const createTask = mock(() => Promise.resolve({ id: 'x', title: 'x', status: 'todo', url: 'https://test.com' }))
    const provider = createMockProvider({ createTask })

    findTemplateByTaskIdResult = makeTemplate({
      triggerType: 'cron',
      cronExpression: '0 9 * * 1',
    })

    await completionHook('cron-task-1', 'done', provider)

    expect(createTask).not.toHaveBeenCalled()
  })

  test('does not fire when template is paused', async () => {
    const { completionHook } = await import('../../src/tools/completion-hook.js')
    const createTask = mock(() => Promise.resolve({ id: 'x', title: 'x', status: 'todo', url: 'https://test.com' }))
    const provider = createMockProvider({ createTask })

    findTemplateByTaskIdResult = makeTemplate({ enabled: false })

    await completionHook('paused-task-1', 'done', provider)

    expect(createTask).not.toHaveBeenCalled()
  })

  test('applies labels when provider supports it', async () => {
    const { completionHook } = await import('../../src/tools/completion-hook.js')
    const createTask = mock(() =>
      Promise.resolve({ id: 'new-task-1', title: 'Test', status: 'todo', url: 'https://test.com' }),
    )
    const addTaskLabel = mock(() => Promise.resolve({ taskId: 'new-task-1', labelId: 'label-1' }))
    const provider = createMockProvider({ createTask, addTaskLabel })

    findTemplateByTaskIdResult = makeTemplate({ labels: ['label-1', 'label-2'] })

    await completionHook('task-1', 'done', provider)

    expect(addTaskLabel).toHaveBeenCalledTimes(2)
  })

  test('no error when completionHook is not provided to makeUpdateTaskTool', async () => {
    const { makeUpdateTaskTool } = await import('../../src/tools/update-task.js')
    const provider = createMockProvider()

    // Should not throw when completionHook is omitted
    const tool = makeUpdateTaskTool(provider)
    expect(tool.description).toContain('Update')
  })
})
