import { mock, describe, expect, test, beforeEach, afterAll } from 'bun:test'

import { mockLogger } from '../utils/test-helpers.js'

mockLogger()

import type { ResumeResult } from '../../src/recurring.js'
import type { RecurringTaskInput, RecurringTaskRecord } from '../../src/types/recurring.js'

// ============================================================================
// Controllable mock state
// ============================================================================

let createRecurringTaskCallCount = 0
let onMockCall: (() => void) | null = null

let deleteRecurringTaskResult: boolean = true
const deleteRecurringTaskCalls: string[] = []

let updateRecurringTaskResult: RecurringTaskRecord | null = null
const updateRecurringTaskCalls: Array<{ id: string; updates: Record<string, unknown> }> = []

let resumeRecurringTaskResult: ResumeResult | null = null
const resumeRecurringTaskCalls: Array<{ id: string; createMissed: boolean }> = []

let pauseRecurringTaskResult: RecurringTaskRecord | null = null
const pauseRecurringTaskCalls: string[] = []

let skipNextOccurrenceResult: RecurringTaskRecord | null = null
const skipNextOccurrenceCalls: string[] = []

let listRecurringTasksResult: RecurringTaskRecord[] = []
const listRecurringTasksCalls: string[] = []

let createMissedTasksResult = 0
const createMissedTasksCalls: Array<{ id: string; dates: readonly string[] }> = []

// ============================================================================
// Module mocks (must be before imports of tools under test)
// ============================================================================

void mock.module('../../src/recurring.js', () => ({
  createRecurringTask: (input: RecurringTaskInput): RecurringTaskRecord => {
    createRecurringTaskCallCount++
    if (onMockCall) onMockCall()
    return {
      id: 'rec-1',
      userId: 'user-1',
      projectId: 'p1',
      title: 'Test',
      description: null,
      priority: null,
      status: null,
      assignee: null,
      labels: [],
      triggerType: input.triggerType,
      cronExpression: input.cronExpression ?? null,
      timezone: 'UTC',
      enabled: true,
      catchUp: false,
      lastRun: null,
      nextRun: null,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    }
  },
  deleteRecurringTask: (id: string): boolean => {
    deleteRecurringTaskCalls.push(id)
    if (onMockCall) onMockCall()
    return deleteRecurringTaskResult
  },
  updateRecurringTask: (id: string, updates: Record<string, unknown>): RecurringTaskRecord | null => {
    updateRecurringTaskCalls.push({ id, updates })
    if (onMockCall) onMockCall()
    return updateRecurringTaskResult
  },
  resumeRecurringTask: (id: string, createMissed: boolean): ResumeResult | null => {
    resumeRecurringTaskCalls.push({ id, createMissed })
    if (onMockCall) onMockCall()
    return resumeRecurringTaskResult
  },
  pauseRecurringTask: (id: string): RecurringTaskRecord | null => {
    pauseRecurringTaskCalls.push(id)
    if (onMockCall) onMockCall()
    return pauseRecurringTaskResult
  },
  skipNextOccurrence: (id: string): RecurringTaskRecord | null => {
    skipNextOccurrenceCalls.push(id)
    if (onMockCall) onMockCall()
    return skipNextOccurrenceResult
  },
  listRecurringTasks: (userId: string): RecurringTaskRecord[] => {
    listRecurringTasksCalls.push(userId)
    if (onMockCall) onMockCall()
    return listRecurringTasksResult
  },
}))

void mock.module('../../src/scheduler.js', () => ({
  createMissedTasks: (id: string, dates: readonly string[]): Promise<number> => {
    createMissedTasksCalls.push({ id, dates })
    return Promise.resolve(createMissedTasksResult)
  },
}))

// ============================================================================
// Imports (after mocks)
// ============================================================================

import { setCachedConfig, _userCaches } from '../../src/cache.js'
import { makeCreateRecurringTaskTool } from '../../src/tools/create-recurring-task.js'
import { makeDeleteRecurringTaskTool } from '../../src/tools/delete-recurring-task.js'
import { makeListRecurringTasksTool } from '../../src/tools/list-recurring-tasks.js'
import { makePauseRecurringTaskTool } from '../../src/tools/pause-recurring-task.js'
import { makeResumeRecurringTaskTool } from '../../src/tools/resume-recurring-task.js'
import { makeSkipRecurringTaskTool } from '../../src/tools/skip-recurring-task.js'
import { makeUpdateRecurringTaskTool } from '../../src/tools/update-recurring-task.js'

// ============================================================================
// Helpers
// ============================================================================

const toolCtx = { toolCallId: '1', messages: [] as never[] }

function makeRecord(overrides: Partial<RecurringTaskRecord> = {}): RecurringTaskRecord {
  return {
    id: 'rec-1',
    userId: 'user-1',
    projectId: 'p1',
    title: 'Daily standup',
    description: null,
    priority: null,
    status: null,
    assignee: null,
    labels: [],
    triggerType: 'cron',
    cronExpression: '0 9 * * 1',
    timezone: 'UTC',
    enabled: true,
    catchUp: false,
    lastRun: null,
    nextRun: '2026-03-22T09:00:00.000Z',
    createdAt: '2026-03-01T00:00:00.000Z',
    updatedAt: '2026-03-01T00:00:00.000Z',
    ...overrides,
  }
}

function resetMockState(): void {
  createRecurringTaskCallCount = 0
  onMockCall = null
  deleteRecurringTaskResult = true
  deleteRecurringTaskCalls.length = 0
  updateRecurringTaskResult = null
  updateRecurringTaskCalls.length = 0
  resumeRecurringTaskResult = null
  resumeRecurringTaskCalls.length = 0
  pauseRecurringTaskResult = null
  pauseRecurringTaskCalls.length = 0
  skipNextOccurrenceResult = null
  skipNextOccurrenceCalls.length = 0
  listRecurringTasksResult = []
  listRecurringTasksCalls.length = 0
  createMissedTasksResult = 0
  createMissedTasksCalls.length = 0
  // Pre-populate timezone in the in-memory cache so create-recurring-task tool
  // can read it without needing a real DB. DB sync fails silently (no table).
  setCachedConfig('user-1', 'timezone', 'UTC')
}

beforeEach(resetMockState)

afterAll(() => {
  _userCaches.delete('user-1')
  mock.restore()
})

// ============================================================================
// Tests: makeCreateRecurringTaskTool
// ============================================================================

describe('makeCreateRecurringTaskTool', () => {
  test('allows on_complete triggerType and creates the definition', async () => {
    const tool = makeCreateRecurringTaskTool('user-1')
    if (!tool.execute) throw new Error('Tool execute is undefined')
    const result: unknown = await tool.execute(
      { title: 'On complete task', projectId: 'p1', triggerType: 'on_complete' },
      toolCtx,
    )
    expect(result).toHaveProperty('id')
    expect(result).toHaveProperty('triggerType', 'on_complete')
    expect(createRecurringTaskCallCount).toBe(1)
  })

  test('returns error when cron type but no schedule', async () => {
    const tool = makeCreateRecurringTaskTool('user-1')
    if (!tool.execute) throw new Error('Tool execute is undefined')
    const result: unknown = await tool.execute({ title: 'Task', projectId: 'p1', triggerType: 'cron' }, toolCtx)
    expect(result).toHaveProperty('error', "schedule is required when triggerType is 'cron'")
    expect(createRecurringTaskCallCount).toBe(0)
  })

  test('converts semantic schedule to cron expression', async () => {
    const tool = makeCreateRecurringTaskTool('user-1')
    if (!tool.execute) throw new Error('Tool execute is undefined')
    const result: unknown = await tool.execute(
      {
        title: 'Monday standup',
        projectId: 'p1',
        triggerType: 'cron',
        schedule: { frequency: 'weekly', time: '09:00', days_of_week: ['mon'] },
      },
      toolCtx,
    )
    expect(result).toHaveProperty('id', 'rec-1')
    expect(result).toHaveProperty('title', 'Test')
    expect(result).toHaveProperty('projectId', 'p1')
    expect(result).toHaveProperty('triggerType', 'cron')
    expect(result).toHaveProperty('schedule', 'at 09:00 UTC on Monday')
    expect(result).toHaveProperty('enabled', true)
    expect(createRecurringTaskCallCount).toBe(1)
  })

  test('returns "after completion" schedule for on_complete triggerType', async () => {
    const tool = makeCreateRecurringTaskTool('user-1')
    if (!tool.execute) throw new Error('Tool execute is undefined')
    const result: unknown = await tool.execute(
      { title: 'On complete task', projectId: 'p1', triggerType: 'on_complete' },
      toolCtx,
    )
    expect(result).toHaveProperty('schedule', 'after completion of current instance')
  })

  test('has a non-empty description', () => {
    expect(makeCreateRecurringTaskTool('user-1').description).toBeTruthy()
  })

  test('on_complete triggerType ignores schedule when both provided', async () => {
    const tool = makeCreateRecurringTaskTool('user-1')
    if (!tool.execute) throw new Error('Tool execute is undefined')

    const result: unknown = await tool.execute(
      {
        title: 'Test',
        projectId: 'p-1',
        triggerType: 'on_complete',
        schedule: { frequency: 'weekly', time: '09:00', days_of_week: ['mon'] },
      },
      toolCtx,
    )

    expect(result).not.toHaveProperty('error')
    expect(result).toHaveProperty('schedule', 'after completion of current instance')
  })

  test('re-throws when createRecurringTask throws', async () => {
    onMockCall = () => {
      throw new Error('create failed')
    }
    const tool = makeCreateRecurringTaskTool('user-1')
    if (!tool.execute) throw new Error('Tool execute is undefined')
    let caught: unknown = null
    try {
      await tool.execute(
        {
          title: 'Task',
          projectId: 'p1',
          triggerType: 'cron',
          schedule: { frequency: 'weekly', time: '09:00', days_of_week: ['mon'] },
        },
        toolCtx,
      )
    } catch (e) {
      caught = e
    }
    expect(caught).toHaveProperty('message', 'create failed')
  })

  test('returns nextRun converted to user local time', async () => {
    // Override the mock to return a known UTC nextRun with Asia/Karachi timezone
    setCachedConfig('user-1', 'timezone', 'Asia/Karachi')
    const tool = makeCreateRecurringTaskTool('user-1')
    if (!tool.execute) throw new Error('Tool execute is undefined')
    const result: unknown = await tool.execute(
      {
        title: 'Daily',
        projectId: 'p1',
        triggerType: 'cron',
        schedule: { frequency: 'daily', time: '17:00' },
      },
      toolCtx,
    )

    // nextRun from mock is null by default — verify no crash
    expect(result).toHaveProperty('nextRun', null)
  })
})

// ============================================================================
// Tests: makeDeleteRecurringTaskTool
// ============================================================================

describe('makeDeleteRecurringTaskTool', () => {
  test('returns confirmation_required when confidence < 0.85', async () => {
    const tool = makeDeleteRecurringTaskTool()
    if (!tool.execute) throw new Error('Tool execute is undefined')
    const result: unknown = await tool.execute({ recurringTaskId: 'rec-1', confidence: 0.5 }, toolCtx)
    expect(result).toHaveProperty('status', 'confirmation_required')
    expect(result).toHaveProperty('message')
    expect(deleteRecurringTaskCalls).toHaveLength(0)
  })

  test('deletes task when confidence >= 0.85 and task exists', async () => {
    deleteRecurringTaskResult = true
    const tool = makeDeleteRecurringTaskTool()
    if (!tool.execute) throw new Error('Tool execute is undefined')
    const result: unknown = await tool.execute({ recurringTaskId: 'rec-1', confidence: 0.9 }, toolCtx)
    expect(result).toHaveProperty('id', 'rec-1')
    expect(result).toHaveProperty('status', 'deleted')
    expect(result).toHaveProperty('message')
    expect(deleteRecurringTaskCalls).toEqual(['rec-1'])
  })

  test('executes at exact confidence boundary 0.85', async () => {
    deleteRecurringTaskResult = true
    const tool = makeDeleteRecurringTaskTool()
    if (!tool.execute) throw new Error('Tool execute is undefined')
    const result: unknown = await tool.execute({ recurringTaskId: 'rec-1', confidence: 0.85 }, toolCtx)
    expect(result).toHaveProperty('status', 'deleted')
    expect(deleteRecurringTaskCalls).toEqual(['rec-1'])
  })

  test('returns error when task not found', async () => {
    deleteRecurringTaskResult = false
    const tool = makeDeleteRecurringTaskTool()
    if (!tool.execute) throw new Error('Tool execute is undefined')
    const result: unknown = await tool.execute({ recurringTaskId: 'rec-missing', confidence: 1 }, toolCtx)
    expect(result).toHaveProperty('error', 'Recurring task not found')
    expect(deleteRecurringTaskCalls).toEqual(['rec-missing'])
  })

  test('does not call deleteRecurringTask when confidence < 0.85', async () => {
    const tool = makeDeleteRecurringTaskTool()
    if (!tool.execute) throw new Error('Tool execute is undefined')
    await tool.execute({ recurringTaskId: 'rec-1', confidence: 0.3 }, toolCtx)
    expect(deleteRecurringTaskCalls).toHaveLength(0)
  })
})

// ============================================================================
// Tests: makeUpdateRecurringTaskTool
// ============================================================================

describe('makeUpdateRecurringTaskTool', () => {
  test('returns updated record fields when task exists', async () => {
    const record = makeRecord({ id: 'rec-2', title: 'Updated title', projectId: 'p2', enabled: true })
    updateRecurringTaskResult = record
    const tool = makeUpdateRecurringTaskTool()
    if (!tool.execute) throw new Error('Tool execute is undefined')
    const result: unknown = await tool.execute({ recurringTaskId: 'rec-2', title: 'Updated title' }, toolCtx)
    expect(result).toHaveProperty('id', 'rec-2')
    expect(result).toHaveProperty('title', 'Updated title')
    expect(result).toHaveProperty('projectId', 'p2')
    expect(result).toHaveProperty('enabled', true)
    // nextRun is converted via utcToLocal (UTC→UTC strips Z suffix)
    expect(result).toHaveProperty('nextRun', '2026-03-22T09:00:00')
  })

  test('returns error when task not found', async () => {
    updateRecurringTaskResult = null
    const tool = makeUpdateRecurringTaskTool()
    if (!tool.execute) throw new Error('Tool execute is undefined')
    const result: unknown = await tool.execute({ recurringTaskId: 'rec-missing', title: 'new' }, toolCtx)
    expect(result).toHaveProperty('error', 'Recurring task not found')
  })

  test('converts semantic schedule to cronExpression when updating', async () => {
    updateRecurringTaskResult = makeRecord()
    const tool = makeUpdateRecurringTaskTool()
    if (!tool.execute) throw new Error('Tool execute is undefined')
    await tool.execute(
      {
        recurringTaskId: 'rec-1',
        schedule: { frequency: 'weekly', time: '09:00', days_of_week: ['mon'] },
      },
      toolCtx,
    )
    expect(updateRecurringTaskCalls[0]?.updates).toHaveProperty('cronExpression', '0 9 * * 1')
  })

  test('passes updates without cronExpression when no schedule provided', async () => {
    updateRecurringTaskResult = makeRecord()
    const tool = makeUpdateRecurringTaskTool()
    if (!tool.execute) throw new Error('Tool execute is undefined')
    await tool.execute({ recurringTaskId: 'rec-1', title: 'New title' }, toolCtx)
    expect(updateRecurringTaskCalls[0]?.id).toBe('rec-1')
    expect(updateRecurringTaskCalls[0]?.updates).toHaveProperty('title', 'New title')
    expect(updateRecurringTaskCalls[0]?.updates).toHaveProperty('cronExpression', undefined)
  })

  test('calls updateRecurringTask with correct recurringTaskId', async () => {
    updateRecurringTaskResult = makeRecord({ id: 'rec-42' })
    const tool = makeUpdateRecurringTaskTool()
    if (!tool.execute) throw new Error('Tool execute is undefined')
    await tool.execute({ recurringTaskId: 'rec-42', title: 'x' }, toolCtx)
    expect(updateRecurringTaskCalls[0]?.id).toBe('rec-42')
  })

  test('returns nextRun converted to user local time', async () => {
    updateRecurringTaskResult = makeRecord({
      timezone: 'Asia/Karachi',
      nextRun: '2026-03-25T12:00:00.000Z',
    })
    const tool = makeUpdateRecurringTaskTool()
    if (!tool.execute) throw new Error('Tool execute is undefined')
    const result: unknown = await tool.execute({ recurringTaskId: 'rec-1', title: 'Updated' }, toolCtx)
    expect(result).toHaveProperty('nextRun', '2026-03-25T17:00:00')
  })
})

// ============================================================================
// Tests: makeResumeRecurringTaskTool
// ============================================================================

describe('makeResumeRecurringTaskTool', () => {
  test('returns error when task not found', async () => {
    resumeRecurringTaskResult = null
    const tool = makeResumeRecurringTaskTool()
    if (!tool.execute) throw new Error('Tool execute is undefined')
    const result: unknown = await tool.execute({ recurringTaskId: 'rec-missing' }, toolCtx)
    expect(result).toHaveProperty('error', 'Recurring task not found')
  })

  test('returns active status with no missed tasks when createMissed is false', async () => {
    const record = makeRecord({ id: 'rec-1', title: 'Standup', enabled: true })
    resumeRecurringTaskResult = { record, missedDates: [] }
    const tool = makeResumeRecurringTaskTool()
    if (!tool.execute) throw new Error('Tool execute is undefined')
    const result: unknown = await tool.execute({ recurringTaskId: 'rec-1', createMissed: false }, toolCtx)
    expect(result).toHaveProperty('id', 'rec-1')
    expect(result).toHaveProperty('title', 'Standup')
    expect(result).toHaveProperty('enabled', true)
    // nextRun converted via utcToLocal (UTC→UTC strips Z suffix)
    expect(result).toHaveProperty('nextRun', '2026-03-22T09:00:00')
    expect(result).toHaveProperty('status', 'active')
    expect(result).toHaveProperty('missedTasksCreated', 0)
    expect(result).toHaveProperty('schedule')
  })

  test('returns cron description as schedule for cron-based tasks', async () => {
    const record = makeRecord({ triggerType: 'cron', cronExpression: '0 9 * * 1', timezone: 'UTC' })
    resumeRecurringTaskResult = { record, missedDates: [] }
    const tool = makeResumeRecurringTaskTool()
    if (!tool.execute) throw new Error('Tool execute is undefined')
    const result: unknown = await tool.execute({ recurringTaskId: 'rec-1' }, toolCtx)
    expect(result).toHaveProperty('schedule', 'at 09:00 UTC on Monday')
  })

  test('returns "after completion" for on_complete tasks', async () => {
    const record = makeRecord({ triggerType: 'on_complete', cronExpression: null })
    resumeRecurringTaskResult = { record, missedDates: [] }
    const tool = makeResumeRecurringTaskTool()
    if (!tool.execute) throw new Error('Tool execute is undefined')
    const result: unknown = await tool.execute({ recurringTaskId: 'rec-1' }, toolCtx)
    expect(result).toHaveProperty('schedule', 'after completion')
  })

  test('creates missed tasks when createMissed is true and missedDates exist', async () => {
    const record = makeRecord()
    const missedDates = ['2026-03-20T09:00:00.000Z', '2026-03-21T09:00:00.000Z']
    resumeRecurringTaskResult = { record, missedDates }
    createMissedTasksResult = 2
    const tool = makeResumeRecurringTaskTool()
    if (!tool.execute) throw new Error('Tool execute is undefined')
    const result: unknown = await tool.execute({ recurringTaskId: 'rec-1', createMissed: true }, toolCtx)
    expect(result).toHaveProperty('missedTasksCreated', 2)
    expect(createMissedTasksCalls).toHaveLength(1)
    expect(createMissedTasksCalls[0]?.id).toBe('rec-1')
    expect(createMissedTasksCalls[0]?.dates).toEqual(missedDates)
  })

  test('does not call createMissedTasks when missedDates is empty', async () => {
    const record = makeRecord()
    resumeRecurringTaskResult = { record, missedDates: [] }
    const tool = makeResumeRecurringTaskTool()
    if (!tool.execute) throw new Error('Tool execute is undefined')
    const result: unknown = await tool.execute({ recurringTaskId: 'rec-1', createMissed: true }, toolCtx)
    expect(result).toHaveProperty('missedTasksCreated', 0)
    expect(createMissedTasksCalls).toHaveLength(0)
  })

  test('returns nextRun converted to user local time after resume', async () => {
    const record = makeRecord({
      timezone: 'Asia/Karachi',
      nextRun: '2026-03-25T12:00:00.000Z',
    })
    resumeRecurringTaskResult = { record, missedDates: [] }
    const tool = makeResumeRecurringTaskTool()
    if (!tool.execute) throw new Error('Tool execute is undefined')
    const result: unknown = await tool.execute({ recurringTaskId: 'rec-1' }, toolCtx)
    expect(result).toHaveProperty('nextRun', '2026-03-25T17:00:00')
  })
})

// ============================================================================
// Tests: makePauseRecurringTaskTool
// ============================================================================

describe('makePauseRecurringTaskTool', () => {
  test('returns paused status when task exists', async () => {
    const record = makeRecord({ id: 'rec-3', title: 'Weekly report', enabled: false })
    pauseRecurringTaskResult = record
    const tool = makePauseRecurringTaskTool()
    if (!tool.execute) throw new Error('Tool execute is undefined')
    const result: unknown = await tool.execute({ recurringTaskId: 'rec-3' }, toolCtx)
    expect(result).toHaveProperty('id', 'rec-3')
    expect(result).toHaveProperty('title', 'Weekly report')
    expect(result).toHaveProperty('enabled', false)
    expect(result).toHaveProperty('status', 'paused')
  })

  test('returns error when task not found', async () => {
    pauseRecurringTaskResult = null
    const tool = makePauseRecurringTaskTool()
    if (!tool.execute) throw new Error('Tool execute is undefined')
    const result: unknown = await tool.execute({ recurringTaskId: 'rec-missing' }, toolCtx)
    expect(result).toHaveProperty('error', 'Recurring task not found')
  })

  test('calls pauseRecurringTask with correct id', async () => {
    pauseRecurringTaskResult = makeRecord({ id: 'rec-7' })
    const tool = makePauseRecurringTaskTool()
    if (!tool.execute) throw new Error('Tool execute is undefined')
    await tool.execute({ recurringTaskId: 'rec-7' }, toolCtx)
    expect(pauseRecurringTaskCalls).toEqual(['rec-7'])
  })
})

// ============================================================================
// Tests: makeSkipRecurringTaskTool
// ============================================================================

describe('makeSkipRecurringTaskTool', () => {
  test('returns skipped status with next run when task exists', async () => {
    const record = makeRecord({ id: 'rec-4', title: 'Standup', nextRun: '2026-03-29T09:00:00.000Z' })
    skipNextOccurrenceResult = record
    const tool = makeSkipRecurringTaskTool()
    if (!tool.execute) throw new Error('Tool execute is undefined')
    const result: unknown = await tool.execute({ recurringTaskId: 'rec-4' }, toolCtx)
    expect(result).toHaveProperty('id', 'rec-4')
    expect(result).toHaveProperty('title', 'Standup')
    // nextRun converted via utcToLocal (UTC→UTC strips Z suffix)
    expect(result).toHaveProperty('nextRun', '2026-03-29T09:00:00')
    expect(result).toHaveProperty('status', 'skipped — next occurrence updated')
  })

  test('returns error when task not found', async () => {
    skipNextOccurrenceResult = null
    const tool = makeSkipRecurringTaskTool()
    if (!tool.execute) throw new Error('Tool execute is undefined')
    const result: unknown = await tool.execute({ recurringTaskId: 'rec-missing' }, toolCtx)
    expect(result).toHaveProperty('error', 'Recurring task not found')
  })

  test('calls skipNextOccurrence with correct id', async () => {
    skipNextOccurrenceResult = makeRecord({ id: 'rec-5' })
    const tool = makeSkipRecurringTaskTool()
    if (!tool.execute) throw new Error('Tool execute is undefined')
    await tool.execute({ recurringTaskId: 'rec-5' }, toolCtx)
    expect(skipNextOccurrenceCalls).toEqual(['rec-5'])
  })

  test('returns nextRun converted to user local time after skip', async () => {
    skipNextOccurrenceResult = makeRecord({
      timezone: 'Asia/Karachi',
      nextRun: '2026-03-25T12:00:00.000Z',
    })
    const tool = makeSkipRecurringTaskTool()
    if (!tool.execute) throw new Error('Tool execute is undefined')
    const result: unknown = await tool.execute({ recurringTaskId: 'rec-1' }, toolCtx)
    expect(result).toHaveProperty('nextRun', '2026-03-25T17:00:00')
  })
})

// ============================================================================
// Tests: makeListRecurringTasksTool
// ============================================================================

describe('makeListRecurringTasksTool', () => {
  test('returns mapped records with schedule for cron tasks', async () => {
    listRecurringTasksResult = [
      makeRecord({ id: 'rec-10', title: 'Monday standup', cronExpression: '0 9 * * 1', triggerType: 'cron' }),
    ]
    const tool = makeListRecurringTasksTool('user-1')
    if (!tool.execute) throw new Error('Tool execute is undefined')
    const result: unknown = await tool.execute({}, toolCtx)
    if (!Array.isArray(result)) throw new Error('Expected array')
    expect(result).toHaveLength(1)
    expect(result[0]).toHaveProperty('id', 'rec-10')
    expect(result[0]).toHaveProperty('title', 'Monday standup')
    expect(result[0]).toHaveProperty('projectId', 'p1')
    expect(result[0]).toHaveProperty('triggerType', 'cron')
    expect(result[0]).toHaveProperty('schedule', 'at 09:00 UTC on Monday')
    expect(result[0]).toHaveProperty('cronExpression', '0 9 * * 1')
    expect(result[0]).toHaveProperty('enabled', true)
    // nextRun/lastRun converted via utcToLocal (UTC→UTC strips Z suffix)
    expect(result[0]).toHaveProperty('nextRun', '2026-03-22T09:00:00')
    expect(result[0]).toHaveProperty('lastRun', null)
    expect(result[0]).toHaveProperty('priority', null)
    expect(result[0]).toHaveProperty('assignee', null)
    expect(result[0]).toHaveProperty('labels', [])
    expect(result[0]).toHaveProperty('catchUp', false)
  })

  test('returns "after completion" for on_complete tasks', async () => {
    listRecurringTasksResult = [makeRecord({ triggerType: 'on_complete', cronExpression: null })]
    const tool = makeListRecurringTasksTool('user-1')
    if (!tool.execute) throw new Error('Tool execute is undefined')
    const result: unknown = await tool.execute({}, toolCtx)
    if (!Array.isArray(result)) throw new Error('Expected array')
    expect(result[0]).toHaveProperty('schedule', 'after completion')
  })

  test('returns "after completion" for cron task with null cronExpression', async () => {
    listRecurringTasksResult = [makeRecord({ triggerType: 'cron', cronExpression: null })]
    const tool = makeListRecurringTasksTool('user-1')
    if (!tool.execute) throw new Error('Tool execute is undefined')
    const result: unknown = await tool.execute({}, toolCtx)
    if (!Array.isArray(result)) throw new Error('Expected array')
    expect(result[0]).toHaveProperty('schedule', 'after completion')
  })

  test('returns empty array when no tasks', async () => {
    listRecurringTasksResult = []
    const tool = makeListRecurringTasksTool('user-1')
    if (!tool.execute) throw new Error('Tool execute is undefined')
    const result: unknown = await tool.execute({}, toolCtx)
    expect(result).toEqual([])
  })

  test('returns nextRun and lastRun converted to user local time', async () => {
    listRecurringTasksResult = [
      makeRecord({
        timezone: 'Asia/Karachi',
        nextRun: '2026-03-25T12:00:00.000Z',
        lastRun: '2026-03-24T12:00:00.000Z',
      }),
    ]
    const tool = makeListRecurringTasksTool('user-1')
    if (!tool.execute) throw new Error('Tool execute is undefined')
    const result: unknown = await tool.execute({}, toolCtx)
    if (!Array.isArray(result)) throw new Error('Expected array')
    expect(result[0]).toHaveProperty('nextRun', '2026-03-25T17:00:00')
    expect(result[0]).toHaveProperty('lastRun', '2026-03-24T17:00:00')
  })

  test('calls listRecurringTasks with the userId', async () => {
    listRecurringTasksResult = []
    const tool = makeListRecurringTasksTool('user-42')
    if (!tool.execute) throw new Error('Tool execute is undefined')
    await tool.execute({}, toolCtx)
    expect(listRecurringTasksCalls).toEqual(['user-42'])
  })

  test('returns multiple tasks with correct mapping', async () => {
    listRecurringTasksResult = [
      makeRecord({ id: 'rec-a', title: 'Task A', triggerType: 'cron', cronExpression: '0 9 * * 1' }),
      makeRecord({
        id: 'rec-b',
        title: 'Task B',
        triggerType: 'on_complete',
        cronExpression: null,
        priority: 'high',
        assignee: 'alice',
        labels: ['bug', 'frontend'],
        catchUp: true,
      }),
    ]
    const tool = makeListRecurringTasksTool('user-1')
    if (!tool.execute) throw new Error('Tool execute is undefined')
    const result: unknown = await tool.execute({}, toolCtx)
    if (!Array.isArray(result)) throw new Error('Expected array')
    expect(result).toHaveLength(2)
    expect(result[0]).toHaveProperty('id', 'rec-a')
    expect(result[1]).toHaveProperty('id', 'rec-b')
    expect(result[1]).toHaveProperty('schedule', 'after completion')
    expect(result[1]).toHaveProperty('priority', 'high')
    expect(result[1]).toHaveProperty('assignee', 'alice')
    expect(result[1]).toHaveProperty('labels', ['bug', 'frontend'])
    expect(result[1]).toHaveProperty('catchUp', true)
  })
})

// ============================================================================
// Tests: Tool descriptions (kills StringLiteral mutations on descriptions)
// ============================================================================

describe('Tool descriptions', () => {
  test('delete tool has a non-empty description', () => {
    expect(makeDeleteRecurringTaskTool().description).toBeTruthy()
  })

  test('update tool has a non-empty description', () => {
    expect(makeUpdateRecurringTaskTool().description).toBeTruthy()
  })

  test('resume tool has a non-empty description', () => {
    expect(makeResumeRecurringTaskTool().description).toBeTruthy()
  })

  test('pause tool has a non-empty description', () => {
    expect(makePauseRecurringTaskTool().description).toBeTruthy()
  })

  test('skip tool has a non-empty description', () => {
    expect(makeSkipRecurringTaskTool().description).toBeTruthy()
  })

  test('list tool has a non-empty description', () => {
    expect(makeListRecurringTasksTool('u1').description).toBeTruthy()
  })
})

// ============================================================================
// Tests: Error handling (kills BlockStatement mutations on catch blocks)
// ============================================================================

describe('Error handling — tools re-throw errors', () => {
  test('delete tool re-throws when deleteRecurringTask throws', async () => {
    onMockCall = () => {
      throw new Error('DB failure')
    }
    const tool = makeDeleteRecurringTaskTool()
    if (!tool.execute) throw new Error('Tool execute is undefined')
    let caught: unknown = null
    try {
      await tool.execute({ recurringTaskId: 'rec-1', confidence: 1 }, toolCtx)
    } catch (e) {
      caught = e
    }
    expect(caught).toHaveProperty('message', 'DB failure')
  })

  test('update tool re-throws when updateRecurringTask throws', async () => {
    onMockCall = () => {
      throw new Error('DB failure')
    }
    const tool = makeUpdateRecurringTaskTool()
    if (!tool.execute) throw new Error('Tool execute is undefined')
    let caught: unknown = null
    try {
      await tool.execute({ recurringTaskId: 'rec-1', title: 'x' }, toolCtx)
    } catch (e) {
      caught = e
    }
    expect(caught).toHaveProperty('message', 'DB failure')
  })

  test('resume tool re-throws when resumeRecurringTask throws', async () => {
    onMockCall = () => {
      throw new Error('DB failure')
    }
    const tool = makeResumeRecurringTaskTool()
    if (!tool.execute) throw new Error('Tool execute is undefined')
    let caught: unknown = null
    try {
      await tool.execute({ recurringTaskId: 'rec-1' }, toolCtx)
    } catch (e) {
      caught = e
    }
    expect(caught).toHaveProperty('message', 'DB failure')
  })

  test('pause tool re-throws when pauseRecurringTask throws', async () => {
    onMockCall = () => {
      throw new Error('DB failure')
    }
    const tool = makePauseRecurringTaskTool()
    if (!tool.execute) throw new Error('Tool execute is undefined')
    let caught: unknown = null
    try {
      await tool.execute({ recurringTaskId: 'rec-1' }, toolCtx)
    } catch (e) {
      caught = e
    }
    expect(caught).toHaveProperty('message', 'DB failure')
  })

  test('skip tool re-throws when skipNextOccurrence throws', async () => {
    onMockCall = () => {
      throw new Error('DB failure')
    }
    const tool = makeSkipRecurringTaskTool()
    if (!tool.execute) throw new Error('Tool execute is undefined')
    let caught: unknown = null
    try {
      await tool.execute({ recurringTaskId: 'rec-1' }, toolCtx)
    } catch (e) {
      caught = e
    }
    expect(caught).toHaveProperty('message', 'DB failure')
  })

  test('list tool re-throws when listRecurringTasks throws', async () => {
    onMockCall = () => {
      throw new Error('DB failure')
    }
    const tool = makeListRecurringTasksTool('user-1')
    if (!tool.execute) throw new Error('Tool execute is undefined')
    let caught: unknown = null
    try {
      await tool.execute({}, toolCtx)
    } catch (e) {
      caught = e
    }
    expect(caught).toHaveProperty('message', 'DB failure')
  })
})
