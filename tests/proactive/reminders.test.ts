import { beforeEach, describe, expect, test } from 'bun:test'

import { mockLogger, setupTestDb, mockDrizzle } from '../utils/test-helpers.js'

mockLogger()
mockDrizzle()

import {
  createReminder,
  listReminders,
  cancelReminder,
  snoozeReminder,
  rescheduleReminder,
  fetchDue,
  markDelivered,
  advanceRecurrence,
} from '../../src/proactive/reminders.js'
import { ProviderClassifiedError } from '../../src/providers/errors.js'

const userId = 'test-user-1'
const otherUser = 'test-user-2'

describe('ReminderService', () => {
  beforeEach(async () => {
    await setupTestDb()
  })

  test('createReminder stores row with status = pending', () => {
    const reminder = createReminder({
      userId,
      text: 'Buy groceries',
      fireAt: new Date(Date.now() + 3600000).toISOString(),
    })

    expect(reminder.status).toBe('pending')
    expect(reminder.text).toBe('Buy groceries')
    expect(reminder.userId).toBe(userId)
    expect(reminder.id).toBeDefined()
  })

  test('createReminder with recurrence stores cron expression', () => {
    const reminder = createReminder({
      userId,
      text: 'Weekly standup',
      fireAt: new Date(Date.now() + 3600000).toISOString(),
      recurrence: '0 9 * * 1',
    })

    expect(reminder.recurrence).toBe('0 9 * * 1')
    expect(reminder.status).toBe('pending')
  })

  test('createReminder with taskId stores link', () => {
    const reminder = createReminder({
      userId,
      text: 'Check task',
      fireAt: new Date(Date.now() + 3600000).toISOString(),
      taskId: 'task-123',
    })

    expect(reminder.taskId).toBe('task-123')
  })

  test('listReminders excludes cancelled reminders', () => {
    createReminder({ userId, text: 'A', fireAt: new Date(Date.now() + 3600000).toISOString() })
    const toCancel = createReminder({ userId, text: 'B', fireAt: new Date(Date.now() + 7200000).toISOString() })
    cancelReminder(toCancel.id, userId)

    const list = listReminders(userId)
    expect(list).toHaveLength(1)
    expect(list[0]!.text).toBe('A')
  })

  test('listReminders includes delivered when includeDelivered = true', () => {
    const r = createReminder({ userId, text: 'Done', fireAt: new Date(Date.now() - 1000).toISOString() })
    markDelivered(r.id)

    expect(listReminders(userId, false)).toHaveLength(0)
    expect(listReminders(userId, true)).toHaveLength(1)
  })

  test('cancelReminder sets status to cancelled', () => {
    const r = createReminder({ userId, text: 'Cancel me', fireAt: new Date(Date.now() + 3600000).toISOString() })
    cancelReminder(r.id, userId)

    const list = listReminders(userId)
    expect(list).toHaveLength(0)
  })

  test('cancelReminder throws not-found for wrong userId', () => {
    const r = createReminder({ userId, text: 'Mine', fireAt: new Date(Date.now() + 3600000).toISOString() })

    let thrown: unknown
    try {
      cancelReminder(r.id, otherUser)
    } catch (e) {
      thrown = e
    }
    expect(thrown).toBeDefined()
    expect(thrown).toBeInstanceOf(ProviderClassifiedError)
    if (thrown instanceof ProviderClassifiedError) {
      expect(thrown.error.code).toBe('not-found')
    }
  })

  test('snoozeReminder sets status to snoozed and updates fire_at', () => {
    const r = createReminder({ userId, text: 'Snooze me', fireAt: new Date(Date.now() + 3600000).toISOString() })
    const newTime = new Date(Date.now() + 7200000).toISOString()

    snoozeReminder(r.id, userId, newTime)

    const list = listReminders(userId)
    expect(list).toHaveLength(1)
    expect(list[0]!.status).toBe('snoozed')
    expect(list[0]!.fireAt).toBe(newTime)
  })

  test('rescheduleReminder updates fire_at and sets status to pending', () => {
    const r = createReminder({ userId, text: 'Move me', fireAt: new Date(Date.now() + 3600000).toISOString() })
    snoozeReminder(r.id, userId, new Date(Date.now() + 7200000).toISOString())

    const newTime = new Date(Date.now() + 10800000).toISOString()
    rescheduleReminder(r.id, userId, newTime)

    const list = listReminders(userId)
    expect(list).toHaveLength(1)
    expect(list[0]!.status).toBe('pending')
    expect(list[0]!.fireAt).toBe(newTime)
  })

  test('fetchDue returns only past-fire_at rows with pending or snoozed status', () => {
    createReminder({ userId, text: 'Due', fireAt: new Date(Date.now() - 60000).toISOString() })
    createReminder({ userId, text: 'Future', fireAt: new Date(Date.now() + 3600000).toISOString() })

    const due = fetchDue()
    expect(due).toHaveLength(1)
    expect(due[0]!.text).toBe('Due')
  })

  test('fetchDue excludes delivered and cancelled rows', () => {
    const delivered = createReminder({ userId, text: 'Delivered', fireAt: new Date(Date.now() - 60000).toISOString() })
    markDelivered(delivered.id)

    const cancelled = createReminder({ userId, text: 'Cancelled', fireAt: new Date(Date.now() - 60000).toISOString() })
    cancelReminder(cancelled.id, userId)

    const due = fetchDue()
    expect(due).toHaveLength(0)
  })

  test('advanceRecurrence updates fire_at to next cron occurrence and resets to pending', () => {
    const r = createReminder({
      userId,
      text: 'Recurring',
      fireAt: new Date(Date.now() - 60000).toISOString(),
      // daily at 9am
      recurrence: '0 9 * * *',
    })

    markDelivered(r.id)
    advanceRecurrence(r.id)

    // After advancing, it should be pending again with a future fire_at
    const list = listReminders(userId)
    expect(list).toHaveLength(1)
    expect(list[0]!.status).toBe('pending')
    expect(new Date(list[0]!.fireAt).getTime()).toBeGreaterThan(Date.now())
  })

  test('markDelivered sets status to delivered', () => {
    const r = createReminder({ userId, text: 'Deliver me', fireAt: new Date(Date.now() - 1000).toISOString() })
    markDelivered(r.id)

    const list = listReminders(userId, true)
    expect(list).toHaveLength(1)
    expect(list[0]!.status).toBe('delivered')
  })
})
