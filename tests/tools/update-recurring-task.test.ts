import { describe, expect, test, beforeEach } from 'bun:test'

import type { UpdateRecurringTaskDeps } from '../../src/tools/update-recurring-task.js'
import { makeUpdateRecurringTaskTool } from '../../src/tools/update-recurring-task.js'
import type { RecurringTaskRecord } from '../../src/types/recurring.js'
import { mockLogger } from '../utils/test-helpers.js'

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
    rrule: 'FREQ=WEEKLY;BYDAY=MO;BYHOUR=9;BYMINUTE=0',
    dtstartUtc: '2026-03-01T09:00:00.000Z',
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

describe('makeUpdateRecurringTaskTool — timezone resolution', () => {
  let getRecurringTaskResult: RecurringTaskRecord | null
  let getRecurringTaskCalls: string[]
  let updateRecurringTaskCalls: Array<{ id: string; updates: Record<string, unknown> }>
  let deps: UpdateRecurringTaskDeps

  beforeEach(() => {
    mockLogger()
    getRecurringTaskResult = makeRecord()
    getRecurringTaskCalls = []
    updateRecurringTaskCalls = []

    deps = {
      getRecurringTask: (id: string): RecurringTaskRecord | null => {
        getRecurringTaskCalls.push(id)
        return getRecurringTaskResult
      },
      updateRecurringTask: (id: string, updates: Record<string, unknown>): RecurringTaskRecord | null => {
        updateRecurringTaskCalls.push({ id, updates })
        return getRecurringTaskResult
      },
    }
  })

  test('uses schedule.timezone for RRULE compilation', async () => {
    getRecurringTaskResult = makeRecord({ timezone: 'America/New_York' })
    deps.updateRecurringTask = (id, updates): RecurringTaskRecord | null => {
      updateRecurringTaskCalls.push({ id, updates })
      return makeRecord({ timezone: 'America/New_York' })
    }

    const tool = makeUpdateRecurringTaskTool('user-1', deps)
    if (!tool.execute) throw new Error('Tool execute is undefined')

    await tool.execute(
      {
        recurringTaskId: 'rec-1',
        schedule: { freq: 'DAILY', byHour: [9], byMinute: [0], timezone: 'America/New_York' },
      },
      toolCtx,
    )

    const call = updateRecurringTaskCalls[0]
    expect(call).toBeDefined()
    expect(call?.updates['rrule']).toContain('BYHOUR=9')
    expect(call?.updates['timezone']).toBe('America/New_York')
  })

  test('returns error immediately when task not found, without calling updateRecurringTask', async () => {
    getRecurringTaskResult = null

    const tool = makeUpdateRecurringTaskTool('user-1', deps)
    if (!tool.execute) throw new Error('Tool execute is undefined')

    const result: unknown = await tool.execute({ recurringTaskId: 'rec-missing', title: 'new' }, toolCtx)

    expect(result).toHaveProperty('error', 'Recurring task not found')
    expect(getRecurringTaskCalls).toEqual(['rec-missing'])
    expect(updateRecurringTaskCalls).toHaveLength(0)
  })

  test('schedule.timezone in RRULE input is used verbatim regardless of existing task timezone', async () => {
    getRecurringTaskResult = makeRecord({ timezone: 'America/New_York' })
    deps.updateRecurringTask = (id, updates): RecurringTaskRecord | null => {
      updateRecurringTaskCalls.push({ id, updates })
      return makeRecord()
    }

    const tool = makeUpdateRecurringTaskTool('user-1', deps)
    if (!tool.execute) throw new Error('Tool execute is undefined')

    await tool.execute(
      {
        recurringTaskId: 'rec-1',
        schedule: { freq: 'DAILY', byHour: [9], byMinute: [0], timezone: 'UTC' },
      },
      toolCtx,
    )

    const call = updateRecurringTaskCalls[0]
    expect(call?.updates['rrule']).toContain('BYHOUR=9')
    expect(call?.updates['timezone']).toBe('UTC')
  })

  test('calls getRecurringTask with the correct id before updating', async () => {
    const tool = makeUpdateRecurringTaskTool('user-1', deps)
    if (!tool.execute) throw new Error('Tool execute is undefined')

    await tool.execute({ recurringTaskId: 'rec-42', title: 'x' }, toolCtx)

    expect(getRecurringTaskCalls).toEqual(['rec-42'])
  })
})
