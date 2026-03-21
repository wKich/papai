import { eq, and, sql } from 'drizzle-orm'

import { allOccurrencesBetween, nextCronOccurrence, parseCron } from './cron.js'
import { getDrizzleDb } from './db/drizzle.js'
import { recurringTasks } from './db/schema.js'
import { logger } from './logger.js'
import type { RecurringTaskInput, RecurringTaskRecord, TriggerType } from './types/recurring.js'

export type { TriggerType, RecurringTaskInput, RecurringTaskRecord } from './types/recurring.js'

const log = logger.child({ scope: 'recurring' })
const generateId = (): string => crypto.randomUUID()

const parseLabels = (raw: string | null): string[] => {
  if (raw === null || raw === '') return []
  const parsed: unknown = JSON.parse(raw)
  if (!Array.isArray(parsed)) return []
  return parsed.filter((v): v is string => typeof v === 'string')
}

const parseTriggerType = (raw: string): TriggerType => {
  if (raw === 'on_complete') return 'on_complete'
  return 'cron'
}

const toRecord = (row: typeof recurringTasks.$inferSelect): RecurringTaskRecord => ({
  id: row.id,
  userId: row.userId,
  projectId: row.projectId,
  title: row.title,
  description: row.description,
  priority: row.priority,
  status: row.status,
  assignee: row.assignee,
  labels: parseLabels(row.labels),
  triggerType: parseTriggerType(row.triggerType),
  cronExpression: row.cronExpression,
  timezone: row.timezone,
  enabled: row.enabled === '1',
  catchUp: row.catchUp === '1',
  lastRun: row.lastRun,
  nextRun: row.nextRun,
  createdAt: row.createdAt,
  updatedAt: row.updatedAt,
})

const computeNextRun = (cronExpression: string, timezone = 'UTC'): string | null => {
  const parsed = parseCron(cronExpression)
  if (parsed === null) return null
  const next = nextCronOccurrence(parsed, new Date(), timezone)
  return next === null ? null : next.toISOString()
}

export const createRecurringTask = (input: RecurringTaskInput): RecurringTaskRecord => {
  log.debug({ userId: input.userId, title: input.title, triggerType: input.triggerType }, 'createRecurringTask called')

  const id = generateId()
  const now = new Date().toISOString()
  const nextRun =
    input.triggerType === 'cron' && input.cronExpression !== undefined
      ? computeNextRun(input.cronExpression, input.timezone ?? 'UTC')
      : null

  const db = getDrizzleDb()
  db.insert(recurringTasks)
    .values({
      id,
      userId: input.userId,
      projectId: input.projectId,
      title: input.title,
      description: input.description ?? null,
      priority: input.priority ?? null,
      status: input.status ?? null,
      assignee: input.assignee ?? null,
      labels: input.labels !== undefined && input.labels.length > 0 ? JSON.stringify(input.labels) : null,
      triggerType: input.triggerType,
      cronExpression: input.cronExpression ?? null,
      timezone: input.timezone ?? 'UTC',
      enabled: '1',
      catchUp: input.catchUp === true ? '1' : '0',
      lastRun: null,
      nextRun,
      createdAt: now,
      updatedAt: now,
    })
    .run()

  log.info({ id, userId: input.userId, title: input.title }, 'Recurring task created')

  return getRecurringTask(id)!
}

export const getRecurringTask = (id: string): RecurringTaskRecord | null => {
  log.debug({ id }, 'getRecurringTask called')

  const db = getDrizzleDb()
  const row = db.select().from(recurringTasks).where(eq(recurringTasks.id, id)).get()
  if (row === undefined) return null
  return toRecord(row)
}

export const listRecurringTasks = (userId: string): RecurringTaskRecord[] => {
  log.debug({ userId }, 'listRecurringTasks called')

  const db = getDrizzleDb()
  const rows = db
    .select()
    .from(recurringTasks)
    .where(eq(recurringTasks.userId, userId))
    .orderBy(sql`${recurringTasks.createdAt} ASC`)
    .all()

  log.info({ userId, count: rows.length }, 'Listed recurring tasks')
  return rows.map(toRecord)
}

export const updateRecurringTask = (
  id: string,
  updates: Partial<
    Pick<
      RecurringTaskInput,
      'title' | 'description' | 'priority' | 'status' | 'assignee' | 'labels' | 'cronExpression' | 'catchUp'
    >
  >,
): RecurringTaskRecord | null => {
  log.debug({ id, updates: Object.keys(updates) }, 'updateRecurringTask called')

  const db = getDrizzleDb()
  const existing = db.select().from(recurringTasks).where(eq(recurringTasks.id, id)).get()
  if (existing === undefined) {
    log.warn({ id }, 'Recurring task not found for update')
    return null
  }

  const set: Partial<typeof recurringTasks.$inferInsert> = { updatedAt: new Date().toISOString() }

  if (updates.title !== undefined) set.title = updates.title
  if (updates.description !== undefined) set.description = updates.description
  if (updates.priority !== undefined) set.priority = updates.priority
  if (updates.status !== undefined) set.status = updates.status
  if (updates.assignee !== undefined) set.assignee = updates.assignee
  if (updates.labels !== undefined) set.labels = JSON.stringify(updates.labels)
  if (updates.catchUp !== undefined) set.catchUp = updates.catchUp ? '1' : '0'

  if (updates.cronExpression !== undefined) {
    set.cronExpression = updates.cronExpression
    set.nextRun = computeNextRun(updates.cronExpression, existing.timezone)
  }

  db.update(recurringTasks).set(set).where(eq(recurringTasks.id, id)).run()

  log.info({ id }, 'Recurring task updated')
  return getRecurringTask(id)
}

export const pauseRecurringTask = (id: string): RecurringTaskRecord | null => {
  log.debug({ id }, 'pauseRecurringTask called')

  const db = getDrizzleDb()
  db.update(recurringTasks)
    .set({ enabled: '0', updatedAt: new Date().toISOString() })
    .where(eq(recurringTasks.id, id))
    .run()

  log.info({ id }, 'Recurring task paused')
  return getRecurringTask(id)
}

export type ResumeResult = {
  record: RecurringTaskRecord
  missedDates: string[]
}

const computeMissedDates = (cronExpr: string, fromDate: string | null, timezone = 'UTC'): string[] => {
  const parsed = parseCron(cronExpr)
  if (parsed === null) return []
  const after = fromDate === null ? new Date(0) : new Date(fromDate)
  const before = new Date()
  const missed = allOccurrencesBetween(parsed, after, before, 100, timezone)
  return missed.map((d) => d.toISOString())
}

export const resumeRecurringTask = (id: string, createMissed: boolean): ResumeResult | null => {
  log.debug({ id, createMissed }, 'resumeRecurringTask called')

  const db = getDrizzleDb()
  const existing = db.select().from(recurringTasks).where(eq(recurringTasks.id, id)).get()
  if (existing === undefined) {
    log.warn({ id }, 'Recurring task not found for resume')
    return null
  }

  const cronExpr = existing.cronExpression
  const tz = existing.timezone
  let missedDates: string[] = []
  const nextRun = cronExpr === null ? existing.nextRun : computeNextRun(cronExpr, tz)

  if (createMissed && cronExpr !== null) {
    missedDates = computeMissedDates(cronExpr, existing.nextRun, tz)
    log.info({ id, missedCount: missedDates.length }, 'Computed missed occurrences')
  }

  db.update(recurringTasks)
    .set({ enabled: '1', nextRun, updatedAt: new Date().toISOString() })
    .where(eq(recurringTasks.id, id))
    .run()

  log.info({ id, createMissed }, 'Recurring task resumed')
  const record = getRecurringTask(id)!
  return { record, missedDates }
}

export const skipNextOccurrence = (id: string): RecurringTaskRecord | null => {
  log.debug({ id }, 'skipNextOccurrence called')

  const db = getDrizzleDb()
  const existing = db.select().from(recurringTasks).where(eq(recurringTasks.id, id)).get()
  if (existing === undefined) {
    log.warn({ id }, 'Recurring task not found for skip')
    return null
  }

  if (existing.cronExpression === null) {
    log.warn({ id }, 'Cannot skip on-complete triggered task')
    return null
  }

  // Advance nextRun past the current nextRun
  const parsed = parseCron(existing.cronExpression)
  if (parsed === null) return toRecord(existing)

  const baseDate = existing.nextRun === null ? new Date() : new Date(existing.nextRun)
  const newNext = nextCronOccurrence(parsed, baseDate, existing.timezone)
  const newNextRun = newNext === null ? null : newNext.toISOString()

  db.update(recurringTasks)
    .set({
      nextRun: newNextRun,
      updatedAt: new Date().toISOString(),
    })
    .where(eq(recurringTasks.id, id))
    .run()

  log.info({ id, skippedRun: existing.nextRun, newNextRun: newNext?.toISOString() }, 'Skipped next occurrence')
  return getRecurringTask(id)
}

export const deleteRecurringTask = (id: string): boolean => {
  log.debug({ id }, 'deleteRecurringTask called')

  const db = getDrizzleDb()
  const existing = db.select({ id: recurringTasks.id }).from(recurringTasks).where(eq(recurringTasks.id, id)).get()
  if (existing === undefined) {
    log.warn({ id }, 'Recurring task not found for deletion')
    return false
  }

  db.delete(recurringTasks).where(eq(recurringTasks.id, id)).run()
  log.info({ id }, 'Recurring task deleted')
  return true
}

/** Get all enabled recurring tasks with nextRun <= now (for the scheduler). */
export const getDueRecurringTasks = (): RecurringTaskRecord[] => {
  log.debug('getDueRecurringTasks called')

  const now = new Date().toISOString()
  const db = getDrizzleDb()
  const rows = db
    .select()
    .from(recurringTasks)
    .where(and(eq(recurringTasks.enabled, '1'), sql`${recurringTasks.nextRun} <= ${now}`))
    .all()

  log.debug({ count: rows.length }, 'Due recurring tasks found')
  return rows.map(toRecord)
}

/** Mark a recurring task as executed and compute nextRun. */
export const markExecuted = (id: string): void => {
  log.debug({ id }, 'markExecuted called')

  const db = getDrizzleDb()
  const existing = db.select().from(recurringTasks).where(eq(recurringTasks.id, id)).get()
  if (existing === undefined) return

  const now = new Date().toISOString()
  let nextRun: string | null = null

  if (existing.triggerType === 'cron' && existing.cronExpression !== null) {
    nextRun = computeNextRun(existing.cronExpression, existing.timezone)
  }

  db.update(recurringTasks).set({ lastRun: now, nextRun, updatedAt: now }).where(eq(recurringTasks.id, id)).run()

  log.info({ id, lastRun: now, nextRun }, 'Recurring task marked as executed')
}
