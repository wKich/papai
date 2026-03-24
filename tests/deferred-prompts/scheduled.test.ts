import { afterAll, beforeEach, describe, expect, mock, test } from 'bun:test'

import { mockLogger, mockDrizzle, setupTestDb } from '../utils/test-helpers.js'

mockLogger()
mockDrizzle()

import {
  advanceScheduledPrompt,
  cancelScheduledPrompt,
  completeScheduledPrompt,
  createScheduledPrompt,
  getScheduledPrompt,
  getScheduledPromptsDue,
  listScheduledPrompts,
  updateScheduledPrompt,
} from '../../src/deferred-prompts/scheduled.js'

const USER_ID = 'user-1'
const OTHER_USER = 'user-2'

beforeEach(async () => {
  await setupTestDb()
})

afterAll(() => {
  mock.restore()
})

describe('createScheduledPrompt', () => {
  test('creates a one-shot prompt', () => {
    const fireAt = new Date(Date.now() + 60_000).toISOString()
    const prompt = createScheduledPrompt(USER_ID, 'Remind me to check tasks', { fireAt })

    expect(prompt.type).toBe('scheduled')
    expect(prompt.id).toBeDefined()
    expect(prompt.userId).toBe(USER_ID)
    expect(prompt.prompt).toBe('Remind me to check tasks')
    expect(prompt.fireAt).toBe(fireAt)
    expect(prompt.cronExpression).toBeNull()
    expect(prompt.status).toBe('active')
    expect(prompt.createdAt).toBeDefined()
    expect(prompt.lastExecutedAt).toBeNull()
  })

  test('creates a recurring prompt with cron expression', () => {
    const fireAt = new Date(Date.now() + 60_000).toISOString()
    const prompt = createScheduledPrompt(USER_ID, 'Daily standup summary', {
      fireAt,
      cronExpression: '0 9 * * *',
    })

    expect(prompt.type).toBe('scheduled')
    expect(prompt.cronExpression).toBe('0 9 * * *')
    expect(prompt.status).toBe('active')
  })
})

describe('listScheduledPrompts', () => {
  test('lists prompts for a user and excludes other users', () => {
    const fireAt = new Date(Date.now() + 60_000).toISOString()
    createScheduledPrompt(USER_ID, 'User 1 prompt A', { fireAt })
    createScheduledPrompt(USER_ID, 'User 1 prompt B', { fireAt })
    createScheduledPrompt(OTHER_USER, 'User 2 prompt', { fireAt })

    const prompts = listScheduledPrompts(USER_ID)
    expect(prompts).toHaveLength(2)
    expect(prompts.every((p) => p.userId === USER_ID)).toBe(true)
  })

  test('filters by status', () => {
    const fireAt = new Date(Date.now() + 60_000).toISOString()
    const p1 = createScheduledPrompt(USER_ID, 'Active prompt', { fireAt })
    createScheduledPrompt(USER_ID, 'Another active', { fireAt })
    cancelScheduledPrompt(p1.id, USER_ID)

    const activeOnly = listScheduledPrompts(USER_ID, 'active')
    expect(activeOnly).toHaveLength(1)
    expect(activeOnly[0]!.prompt).toBe('Another active')

    const cancelledOnly = listScheduledPrompts(USER_ID, 'cancelled')
    expect(cancelledOnly).toHaveLength(1)
    expect(cancelledOnly[0]!.prompt).toBe('Active prompt')
  })
})

describe('getScheduledPrompt', () => {
  test('gets a prompt by id', () => {
    const fireAt = new Date(Date.now() + 60_000).toISOString()
    const created = createScheduledPrompt(USER_ID, 'Test prompt', { fireAt })

    const found = getScheduledPrompt(created.id, USER_ID)
    expect(found).not.toBeNull()
    expect(found!.id).toBe(created.id)
    expect(found!.prompt).toBe('Test prompt')
  })

  test('returns null for wrong user', () => {
    const fireAt = new Date(Date.now() + 60_000).toISOString()
    const created = createScheduledPrompt(USER_ID, 'Private prompt', { fireAt })

    const found = getScheduledPrompt(created.id, OTHER_USER)
    expect(found).toBeNull()
  })
})

describe('updateScheduledPrompt', () => {
  test('updates prompt text', () => {
    const fireAt = new Date(Date.now() + 60_000).toISOString()
    const created = createScheduledPrompt(USER_ID, 'Old text', { fireAt })

    const updated = updateScheduledPrompt(created.id, USER_ID, { prompt: 'New text' })
    expect(updated).not.toBeNull()
    expect(updated!.prompt).toBe('New text')
  })

  test('returns null for non-existent prompt', () => {
    const result = updateScheduledPrompt('nonexistent-id', USER_ID, { prompt: 'X' })
    expect(result).toBeNull()
  })
})

describe('cancelScheduledPrompt', () => {
  test('sets status to cancelled', () => {
    const fireAt = new Date(Date.now() + 60_000).toISOString()
    const created = createScheduledPrompt(USER_ID, 'Cancel me', { fireAt })

    const cancelled = cancelScheduledPrompt(created.id, USER_ID)
    expect(cancelled).not.toBeNull()
    expect(cancelled!.status).toBe('cancelled')
  })

  test('returns null for wrong user', () => {
    const fireAt = new Date(Date.now() + 60_000).toISOString()
    const created = createScheduledPrompt(USER_ID, 'Cancel me', { fireAt })

    const result = cancelScheduledPrompt(created.id, OTHER_USER)
    expect(result).toBeNull()
  })
})

describe('getScheduledPromptsDue', () => {
  test('returns only prompts with fire_at in the past', () => {
    const pastTime = new Date(Date.now() - 60_000).toISOString()
    const futureTime = new Date(Date.now() + 3_600_000).toISOString()

    createScheduledPrompt(USER_ID, 'Past prompt', { fireAt: pastTime })
    createScheduledPrompt(USER_ID, 'Future prompt', { fireAt: futureTime })

    const due = getScheduledPromptsDue()
    expect(due).toHaveLength(1)
    expect(due[0]!.prompt).toBe('Past prompt')
  })

  test('does not return cancelled prompts', () => {
    const pastTime = new Date(Date.now() - 60_000).toISOString()
    const created = createScheduledPrompt(USER_ID, 'Cancelled past', { fireAt: pastTime })
    cancelScheduledPrompt(created.id, USER_ID)

    const due = getScheduledPromptsDue()
    expect(due).toHaveLength(0)
  })
})

describe('advanceScheduledPrompt', () => {
  test('updates fire_at and last_executed_at for recurring prompt', () => {
    const fireAt = new Date(Date.now() - 60_000).toISOString()
    const created = createScheduledPrompt(USER_ID, 'Recurring', {
      fireAt,
      cronExpression: '0 9 * * *',
    })

    const nextFireAt = new Date(Date.now() + 86_400_000).toISOString()
    const executedAt = new Date().toISOString()
    advanceScheduledPrompt(created.id, nextFireAt, executedAt)

    const updated = getScheduledPrompt(created.id, USER_ID)
    expect(updated).not.toBeNull()
    expect(updated!.fireAt).toBe(nextFireAt)
    expect(updated!.lastExecutedAt).toBe(executedAt)
    expect(updated!.status).toBe('active')
  })
})

describe('completeScheduledPrompt', () => {
  test('sets status to completed and last_executed_at', () => {
    const fireAt = new Date(Date.now() - 60_000).toISOString()
    const created = createScheduledPrompt(USER_ID, 'One-shot', { fireAt })

    const executedAt = new Date().toISOString()
    completeScheduledPrompt(created.id, executedAt)

    const updated = getScheduledPrompt(created.id, USER_ID)
    expect(updated).not.toBeNull()
    expect(updated!.status).toBe('completed')
    expect(updated!.lastExecutedAt).toBe(executedAt)
  })
})
