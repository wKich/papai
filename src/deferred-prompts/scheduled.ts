import { and, eq, lte } from 'drizzle-orm'

import { getDrizzleDb } from '../db/drizzle.js'
import { scheduledPrompts } from '../db/schema.js'
import type { ScheduledPromptRow } from '../db/schema.js'
import { logger } from '../logger.js'
import type { ScheduledPrompt } from './types.js'

const log = logger.child({ scope: 'deferred:scheduled' })

function isValidStatus(value: string): value is ScheduledPrompt['status'] {
  return value === 'active' || value === 'completed' || value === 'cancelled'
}

function toStatus(value: string): ScheduledPrompt['status'] {
  return isValidStatus(value) ? value : 'active'
}

function toScheduledPrompt(row: ScheduledPromptRow): ScheduledPrompt {
  return {
    type: 'scheduled',
    id: row.id,
    userId: row.userId,
    prompt: row.prompt,
    fireAt: row.fireAt,
    cronExpression: row.cronExpression,
    status: toStatus(row.status),
    createdAt: row.createdAt,
    lastExecutedAt: row.lastExecutedAt,
  }
}

export function createScheduledPrompt(
  userId: string,
  prompt: string,
  schedule: { fireAt: string; cronExpression?: string },
): ScheduledPrompt {
  log.debug({ userId, hasCron: schedule.cronExpression !== undefined }, 'createScheduledPrompt called')

  const db = getDrizzleDb()
  const id = crypto.randomUUID()
  const fireAt = new Date(schedule.fireAt).toISOString()

  db.insert(scheduledPrompts)
    .values({
      id,
      userId,
      prompt,
      fireAt,
      cronExpression: schedule.cronExpression ?? null,
      status: 'active',
    })
    .run()

  const row = db.select().from(scheduledPrompts).where(eq(scheduledPrompts.id, id)).get()

  log.info({ id, userId }, 'Scheduled prompt created')
  return toScheduledPrompt(row!)
}

export function listScheduledPrompts(userId: string, status?: string): ScheduledPrompt[] {
  log.debug({ userId, hasStatus: status !== undefined }, 'listScheduledPrompts called')

  const db = getDrizzleDb()

  const conditions = [eq(scheduledPrompts.userId, userId)]
  if (status !== undefined) {
    conditions.push(eq(scheduledPrompts.status, status))
  }

  const rows = db
    .select()
    .from(scheduledPrompts)
    .where(and(...conditions))
    .all()

  return rows.map(toScheduledPrompt)
}

export function getScheduledPrompt(id: string, userId: string): ScheduledPrompt | null {
  log.debug({ id, userId }, 'getScheduledPrompt called')

  const db = getDrizzleDb()

  const row = db
    .select()
    .from(scheduledPrompts)
    .where(and(eq(scheduledPrompts.id, id), eq(scheduledPrompts.userId, userId)))
    .get()

  if (row === undefined) {
    return null
  }

  return toScheduledPrompt(row)
}

function buildUpdateValues(updates: {
  prompt?: string
  fireAt?: string
  cronExpression?: string
}): Record<string, string> {
  const values: Record<string, string> = {}
  if (updates.prompt !== undefined) values['prompt'] = updates.prompt
  if (updates.fireAt !== undefined) values['fireAt'] = new Date(updates.fireAt).toISOString()
  if (updates.cronExpression !== undefined) values['cronExpression'] = updates.cronExpression
  return values
}

export function updateScheduledPrompt(
  id: string,
  userId: string,
  updates: { prompt?: string; fireAt?: string; cronExpression?: string },
): ScheduledPrompt | null {
  log.debug({ id, userId }, 'updateScheduledPrompt called')

  const db = getDrizzleDb()
  const ownerFilter = and(eq(scheduledPrompts.id, id), eq(scheduledPrompts.userId, userId))

  const existing = db.select().from(scheduledPrompts).where(ownerFilter).get()
  if (existing === undefined) return null

  const setValues = buildUpdateValues(updates)
  if (Object.keys(setValues).length > 0) {
    db.update(scheduledPrompts).set(setValues).where(ownerFilter).run()
  }

  const row = db.select().from(scheduledPrompts).where(eq(scheduledPrompts.id, id)).get()
  log.info({ id, userId }, 'Scheduled prompt updated')
  return toScheduledPrompt(row!)
}

export function cancelScheduledPrompt(id: string, userId: string): ScheduledPrompt | null {
  log.debug({ id, userId }, 'cancelScheduledPrompt called')

  const db = getDrizzleDb()

  const existing = db
    .select()
    .from(scheduledPrompts)
    .where(and(eq(scheduledPrompts.id, id), eq(scheduledPrompts.userId, userId)))
    .get()

  if (existing === undefined) {
    return null
  }

  db.update(scheduledPrompts)
    .set({ status: 'cancelled' })
    .where(and(eq(scheduledPrompts.id, id), eq(scheduledPrompts.userId, userId)))
    .run()

  const row = db.select().from(scheduledPrompts).where(eq(scheduledPrompts.id, id)).get()

  log.info({ id, userId }, 'Scheduled prompt cancelled')
  return toScheduledPrompt(row!)
}

export function getScheduledPromptsDue(limit = 100): ScheduledPrompt[] {
  log.debug({ limit }, 'getScheduledPromptsDue called')

  const db = getDrizzleDb()
  const now = new Date().toISOString()

  const rows = db
    .select()
    .from(scheduledPrompts)
    .where(and(eq(scheduledPrompts.status, 'active'), lte(scheduledPrompts.fireAt, now)))
    .limit(limit ?? 100)
    .all()

  return rows.map(toScheduledPrompt)
}

export function advanceScheduledPrompt(id: string, nextFireAt: string, lastExecutedAt: string): void {
  log.debug({ id }, 'advanceScheduledPrompt called')

  const db = getDrizzleDb()

  db.update(scheduledPrompts)
    .set({
      fireAt: new Date(nextFireAt).toISOString(),
      lastExecutedAt: new Date(lastExecutedAt).toISOString(),
    })
    .where(eq(scheduledPrompts.id, id))
    .run()

  log.info({ id }, 'Scheduled prompt advanced')
}

export function completeScheduledPrompt(id: string, lastExecutedAt: string): void {
  log.debug({ id }, 'completeScheduledPrompt called')

  const db = getDrizzleDb()

  db.update(scheduledPrompts)
    .set({
      status: 'completed',
      lastExecutedAt: new Date(lastExecutedAt).toISOString(),
    })
    .where(eq(scheduledPrompts.id, id))
    .run()

  log.info({ id }, 'Scheduled prompt completed')
}
