import { and, eq, inArray, lte } from 'drizzle-orm'

import { nextCronOccurrence, parseCron } from '../cron.js'
import { getDrizzleDb } from '../db/drizzle.js'
import { reminders } from '../db/schema.js'
import { logger } from '../logger.js'
import { ProviderClassifiedError, providerError } from '../providers/errors.js'
import type { CreateReminderParams, ReminderStatus } from './types.js'

const log = logger.child({ scope: 'proactive:reminders' })

const generateId = (): string => crypto.randomUUID()

/** Normalize an ISO 8601 string to canonical UTC (Date.toISOString()). */
const normalizeTimestamp = (iso: string): string => new Date(iso).toISOString()

function throwReminderNotFound(reminderId: string): never {
  throw new ProviderClassifiedError(
    `reminder "${reminderId}" was not found.`,
    providerError.notFound('reminder', reminderId),
  )
}

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
    fireAt: normalizeTimestamp(params.fireAt),
    recurrence: params.recurrence ?? null,
    taskId: params.taskId ?? null,
    status: 'pending' satisfies ReminderStatus,
  }
  db.insert(reminders).values(row).run()
  log.info({ reminderId: id, userId: params.userId }, 'Reminder created')

  const created = db.select().from(reminders).where(eq(reminders.id, id)).get()
  return created!
}

export function listReminders(userId: string, includeDelivered = false): Array<typeof reminders.$inferSelect> {
  log.debug({ userId, includeDelivered }, 'listReminders called')
  const db = getDrizzleDb()

  const validStatuses: ReminderStatus[] = includeDelivered
    ? ['pending', 'snoozed', 'delivered']
    : ['pending', 'snoozed']

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
    throwReminderNotFound(reminderId)
  }

  db.update(reminders)
    .set({ status: 'cancelled' satisfies ReminderStatus })
    .where(eq(reminders.id, reminderId))
    .run()

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
    throwReminderNotFound(reminderId)
  }

  const normalized = normalizeTimestamp(newFireAt)
  db.update(reminders)
    .set({ status: 'snoozed' satisfies ReminderStatus, fireAt: normalized })
    .where(eq(reminders.id, reminderId))
    .run()

  log.info({ reminderId, userId, newFireAt: normalized }, 'Reminder snoozed')
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
    throwReminderNotFound(reminderId)
  }

  const normalized = normalizeTimestamp(newFireAt)
  db.update(reminders)
    .set({ status: 'pending' satisfies ReminderStatus, fireAt: normalized })
    .where(eq(reminders.id, reminderId))
    .run()

  log.info({ reminderId, userId, newFireAt: normalized }, 'Reminder rescheduled')
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

  db.update(reminders)
    .set({ status: 'delivered' satisfies ReminderStatus })
    .where(eq(reminders.id, reminderId))
    .run()

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
    .set({ fireAt: nextFire.toISOString(), status: 'pending' satisfies ReminderStatus })
    .where(eq(reminders.id, reminderId))
    .run()

  log.info({ reminderId, nextFireAt: nextFire.toISOString() }, 'Recurring reminder advanced')
}
