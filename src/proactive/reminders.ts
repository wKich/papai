import { and, eq, inArray, lte } from 'drizzle-orm'

import { nextCronOccurrence, parseCron } from '../cron.js'
import { getDrizzleDb } from '../db/drizzle.js'
import { reminders } from '../db/schema.js'
import { logger } from '../logger.js'
import type { CreateReminderParams } from './types.js'

const log = logger.child({ scope: 'proactive:reminders' })

const generateId = (): string => crypto.randomUUID()

export function createReminder(params: CreateReminderParams): typeof reminders.$inferSelect {
  log.debug(
    { userId: params.userId, fireAt: params.fireAt, hasRecurrence: params.recurrence !== undefined },
    'createReminder called',
  )
  const db = getDrizzleDb()
  const id = generateId()
  const row = {
    id,
    userId: params.userId,
    text: params.text,
    fireAt: params.fireAt,
    recurrence: params.recurrence ?? null,
    taskId: params.taskId ?? null,
    status: 'pending',
  }
  db.insert(reminders).values(row).run()
  log.info({ reminderId: id, userId: params.userId }, 'Reminder created')

  const created = db.select().from(reminders).where(eq(reminders.id, id)).get()
  return created!
}

export function listReminders(userId: string, includeDelivered = false): Array<typeof reminders.$inferSelect> {
  log.debug({ userId, includeDelivered }, 'listReminders called')
  const db = getDrizzleDb()

  const validStatuses = includeDelivered ? ['pending', 'snoozed', 'delivered'] : ['pending', 'snoozed']

  return db
    .select()
    .from(reminders)
    .where(and(eq(reminders.userId, userId), inArray(reminders.status, validStatuses)))
    .all()
}

export function cancelReminder(reminderId: string, userId: string): void {
  log.debug({ reminderId, userId }, 'cancelReminder called')
  const db = getDrizzleDb()

  const row = db
    .select()
    .from(reminders)
    .where(and(eq(reminders.id, reminderId), eq(reminders.userId, userId)))
    .get()

  if (row === undefined) {
    throw new ReminderNotFoundError(reminderId)
  }

  db.update(reminders).set({ status: 'cancelled' }).where(eq(reminders.id, reminderId)).run()

  log.info({ reminderId, userId }, 'Reminder cancelled')
}

export function snoozeReminder(reminderId: string, userId: string, newFireAt: string): void {
  log.debug({ reminderId, userId, newFireAt }, 'snoozeReminder called')
  const db = getDrizzleDb()

  const row = db
    .select()
    .from(reminders)
    .where(and(eq(reminders.id, reminderId), eq(reminders.userId, userId)))
    .get()

  if (row === undefined) {
    throw new ReminderNotFoundError(reminderId)
  }

  db.update(reminders).set({ status: 'snoozed', fireAt: newFireAt }).where(eq(reminders.id, reminderId)).run()

  log.info({ reminderId, userId, newFireAt }, 'Reminder snoozed')
}

export function rescheduleReminder(reminderId: string, userId: string, newFireAt: string): void {
  log.debug({ reminderId, userId, newFireAt }, 'rescheduleReminder called')
  const db = getDrizzleDb()

  const row = db
    .select()
    .from(reminders)
    .where(and(eq(reminders.id, reminderId), eq(reminders.userId, userId)))
    .get()

  if (row === undefined) {
    throw new ReminderNotFoundError(reminderId)
  }

  db.update(reminders).set({ status: 'pending', fireAt: newFireAt }).where(eq(reminders.id, reminderId)).run()

  log.info({ reminderId, userId, newFireAt }, 'Reminder rescheduled')
}

export function fetchDue(): Array<typeof reminders.$inferSelect> {
  log.debug('fetchDue called')
  const db = getDrizzleDb()
  const now = new Date().toISOString()

  return db
    .select()
    .from(reminders)
    .where(and(inArray(reminders.status, ['pending', 'snoozed']), lte(reminders.fireAt, now)))
    .all()
}

export function markDelivered(reminderId: string): void {
  log.debug({ reminderId }, 'markDelivered called')
  const db = getDrizzleDb()

  db.update(reminders).set({ status: 'delivered' }).where(eq(reminders.id, reminderId)).run()

  log.info({ reminderId }, 'Reminder marked as delivered')
}

export function advanceRecurrence(reminderId: string): void {
  log.debug({ reminderId }, 'advanceRecurrence called')
  const db = getDrizzleDb()

  const row = db.select().from(reminders).where(eq(reminders.id, reminderId)).get()
  if (row === undefined || row.recurrence === null) return

  const parsed = parseCron(row.recurrence)
  if (parsed === null) {
    log.warn({ reminderId, recurrence: row.recurrence }, 'Invalid recurrence expression in reminder')
    return
  }

  const nextFire = nextCronOccurrence(parsed, new Date())
  if (nextFire === null) {
    log.warn({ reminderId }, 'Could not compute next occurrence for recurring reminder')
    return
  }

  db.update(reminders)
    .set({ fireAt: nextFire.toISOString(), status: 'pending' })
    .where(eq(reminders.id, reminderId))
    .run()

  log.info({ reminderId, nextFireAt: nextFire.toISOString() }, 'Recurring reminder advanced')
}

export class ReminderNotFoundError extends Error {
  constructor(public readonly reminderId: string) {
    super(`Reminder "${reminderId}" not found`)
    this.name = 'ReminderNotFoundError'
  }
}
