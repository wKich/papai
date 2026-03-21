import { mock, describe, expect, test } from 'bun:test'

import { mockLogger } from '../utils/test-helpers.js'

mockLogger()

import type { RecurringTaskInput, RecurringTaskRecord } from '../../src/types/recurring.js'

// Mock recurring store — should NOT be called for invalid input
let createRecurringTaskCallCount = 0
void mock.module('../../src/recurring.js', () => ({
  createRecurringTask: (input: RecurringTaskInput): RecurringTaskRecord => {
    createRecurringTaskCallCount++
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
      triggerType: 'cron',
      // cronExpression from input (may be undefined for on_complete)
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
}))

import { makeCreateRecurringTaskTool } from '../../src/tools/create-recurring-task.js'

describe('makeCreateRecurringTaskTool', () => {
  test('allows on_complete triggerType and creates the definition', async () => {
    createRecurringTaskCallCount = 0
    const tool = makeCreateRecurringTaskTool('user-1')
    if (!tool.execute) throw new Error('Tool execute is undefined')
    const result: unknown = await tool.execute(
      { title: 'On complete task', projectId: 'p1', triggerType: 'on_complete' },
      { toolCallId: '1', messages: [] },
    )
    expect(result).toHaveProperty('id')
    expect(result).toHaveProperty('triggerType', 'cron')
    expect(createRecurringTaskCallCount).toBe(1)
  })

  test('returns error for invalid cron expression', async () => {
    createRecurringTaskCallCount = 0
    const tool = makeCreateRecurringTaskTool('user-1')
    if (!tool.execute) throw new Error('Tool execute is undefined')
    const result: unknown = await tool.execute(
      { title: 'Test task', projectId: 'p1', triggerType: 'cron', cronExpression: 'not-a-valid-cron' },
      { toolCallId: '1', messages: [] },
    )
    expect(result).toHaveProperty('error')
    expect(createRecurringTaskCallCount).toBe(0)
  })

  test('returns error for out-of-range cron values like 99 99 99 99 99', async () => {
    createRecurringTaskCallCount = 0
    const tool = makeCreateRecurringTaskTool('user-1')
    if (!tool.execute) throw new Error('Tool execute is undefined')
    const result: unknown = await tool.execute(
      { title: 'Test task', projectId: 'p1', triggerType: 'cron', cronExpression: '99 99 99 99 99' },
      { toolCallId: '1', messages: [] },
    )
    expect(result).toHaveProperty('error')
    expect(createRecurringTaskCallCount).toBe(0)
  })
})
