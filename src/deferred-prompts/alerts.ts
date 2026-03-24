import { and, eq, isNull, or, sql } from 'drizzle-orm'

import { getDrizzleDb } from '../db/drizzle.js'
import { alertPrompts, type AlertPromptRow } from '../db/schema.js'
import { logger } from '../logger.js'
import type { Task } from '../providers/types.js'
import { alertConditionSchema, type AlertCondition, type AlertPrompt, type LeafCondition } from './types.js'

const log = logger.child({ scope: 'deferred:alerts' })

// --- Row mapper ---

const parseStatus = (raw: string): AlertPrompt['status'] => (raw === 'cancelled' ? 'cancelled' : 'active')

const toAlertPrompt = (row: AlertPromptRow): AlertPrompt => ({
  type: 'alert',
  id: row.id,
  userId: row.userId,
  prompt: row.prompt,
  condition: alertConditionSchema.parse(JSON.parse(row.condition)),
  status: parseStatus(row.status),
  createdAt: row.createdAt,
  lastTriggeredAt: row.lastTriggeredAt,
  cooldownMinutes: row.cooldownMinutes,
})

// --- CRUD ---

export const createAlertPrompt = (
  userId: string,
  prompt: string,
  condition: AlertCondition,
  cooldownMinutes?: number,
): AlertPrompt => {
  log.debug({ userId, cooldownMinutes }, 'createAlertPrompt called')
  const id = crypto.randomUUID()
  const db = getDrizzleDb()

  db.insert(alertPrompts)
    .values({
      id,
      userId,
      prompt,
      condition: JSON.stringify(condition),
      status: 'active',
      createdAt: new Date().toISOString(),
      lastTriggeredAt: null,
      cooldownMinutes: cooldownMinutes ?? 60,
    })
    .run()

  log.info({ id, userId }, 'Alert prompt created')
  return toAlertPrompt(db.select().from(alertPrompts).where(eq(alertPrompts.id, id)).get()!)
}

export const listAlertPrompts = (userId: string, status?: string): AlertPrompt[] => {
  log.debug({ userId, status }, 'listAlertPrompts called')
  const db = getDrizzleDb()
  const conditions = [eq(alertPrompts.userId, userId)]
  if (status !== undefined) conditions.push(eq(alertPrompts.status, status))

  const rows = db
    .select()
    .from(alertPrompts)
    .where(and(...conditions))
    .all()
  log.info({ userId, count: rows.length }, 'Listed alert prompts')
  return rows.map(toAlertPrompt)
}

export const getAlertPrompt = (id: string, userId: string): AlertPrompt | null => {
  log.debug({ id, userId }, 'getAlertPrompt called')
  const db = getDrizzleDb()
  const row = db
    .select()
    .from(alertPrompts)
    .where(and(eq(alertPrompts.id, id), eq(alertPrompts.userId, userId)))
    .get()

  if (row === undefined) {
    log.debug({ id, userId }, 'Alert prompt not found')
    return null
  }
  return toAlertPrompt(row)
}

export const updateAlertPrompt = (
  id: string,
  userId: string,
  updates: { prompt?: string; condition?: AlertCondition; cooldownMinutes?: number },
): AlertPrompt | null => {
  log.debug({ id, userId, updates: Object.keys(updates) }, 'updateAlertPrompt called')
  const db = getDrizzleDb()
  const existing = db
    .select()
    .from(alertPrompts)
    .where(and(eq(alertPrompts.id, id), eq(alertPrompts.userId, userId)))
    .get()

  if (existing === undefined) {
    log.warn({ id, userId }, 'Alert prompt not found for update')
    return null
  }

  const set: Partial<typeof alertPrompts.$inferInsert> = {}
  if (updates.prompt !== undefined) set.prompt = updates.prompt
  if (updates.condition !== undefined) {
    set.condition = JSON.stringify(updates.condition)
  }
  if (updates.cooldownMinutes !== undefined) set.cooldownMinutes = updates.cooldownMinutes

  db.update(alertPrompts)
    .set(set)
    .where(and(eq(alertPrompts.id, id), eq(alertPrompts.userId, userId)))
    .run()
  log.info({ id, userId }, 'Alert prompt updated')
  return getAlertPrompt(id, userId)
}

export const cancelAlertPrompt = (id: string, userId: string): AlertPrompt | null => {
  log.debug({ id, userId }, 'cancelAlertPrompt called')
  const db = getDrizzleDb()
  const existing = db
    .select()
    .from(alertPrompts)
    .where(and(eq(alertPrompts.id, id), eq(alertPrompts.userId, userId)))
    .get()

  if (existing === undefined) {
    log.warn({ id, userId }, 'Alert prompt not found for cancel')
    return null
  }

  db.update(alertPrompts)
    .set({ status: 'cancelled' })
    .where(and(eq(alertPrompts.id, id), eq(alertPrompts.userId, userId)))
    .run()
  log.info({ id, userId }, 'Alert prompt cancelled')
  return getAlertPrompt(id, userId)
}

export const updateAlertTriggerTime = (id: string, userId: string, lastTriggeredAt: string): void => {
  log.debug({ id, userId, lastTriggeredAt }, 'updateAlertTriggerTime called')
  const db = getDrizzleDb()
  db.update(alertPrompts)
    .set({ lastTriggeredAt })
    .where(and(eq(alertPrompts.id, id), eq(alertPrompts.userId, userId)))
    .run()
  log.info({ id, userId }, 'Alert trigger time updated')
}

export const getEligibleAlertPrompts = (): AlertPrompt[] => {
  log.debug('getEligibleAlertPrompts called')
  const now = new Date().toISOString()
  const db = getDrizzleDb()

  const rows = db
    .select()
    .from(alertPrompts)
    .where(
      and(
        eq(alertPrompts.status, 'active'),
        or(
          isNull(alertPrompts.lastTriggeredAt),
          sql`datetime(${alertPrompts.lastTriggeredAt}, '+' || ${alertPrompts.cooldownMinutes} || ' minutes') <= datetime(${now})`,
        ),
      ),
    )
    .all()

  log.info({ count: rows.length }, 'Eligible alert prompts found')
  return rows.map(toAlertPrompt)
}

// --- Condition evaluation ---

const getFieldValue = (task: Task, field: string): string | string[] | null | undefined => {
  switch (field) {
    case 'task.status':
      return task.status ?? null
    case 'task.priority':
      return task.priority ?? null
    case 'task.assignee':
      return task.assignee ?? null
    case 'task.dueDate':
      return task.dueDate ?? null
    case 'task.project':
      return task.projectId ?? null
    case 'task.labels':
      return (task.labels ?? []).map((l) => l.name)
    default:
      return undefined
  }
}

const evaluateLeaf = (leaf: LeafCondition, task: Task, snapshots: Map<string, string>): boolean => {
  const { field, op, value } = leaf
  const fieldValue = getFieldValue(task, field)

  switch (op) {
    case 'eq':
      return fieldValue === String(value)
    case 'neq':
      return fieldValue !== String(value)
    case 'changed_to': {
      const prev = snapshots.get(`${task.id}:${field.replace('task.', '')}`)
      if (prev === undefined) return false
      return prev !== String(value) && fieldValue === String(value)
    }
    case 'overdue': {
      if (typeof fieldValue !== 'string' || fieldValue === '') return false
      return new Date(fieldValue) < new Date()
    }
    case 'gt': {
      if (typeof fieldValue !== 'string' || fieldValue === '') return false
      return new Date(fieldValue) > new Date(String(value))
    }
    case 'lt': {
      if (typeof fieldValue !== 'string' || fieldValue === '') return false
      return new Date(fieldValue) < new Date(String(value))
    }
    case 'contains':
      return Array.isArray(fieldValue) && fieldValue.includes(String(value))
    case 'not_contains':
      return Array.isArray(fieldValue) && !fieldValue.includes(String(value))
    default:
      log.warn({ op, field }, 'Unknown operator')
      return false
  }
}

export const evaluateCondition = (condition: AlertCondition, task: Task, snapshots: Map<string, string>): boolean => {
  if ('and' in condition) return condition.and.every((c) => evaluateCondition(c, task, snapshots))
  if ('or' in condition) return condition.or.some((c) => evaluateCondition(c, task, snapshots))
  return evaluateLeaf(condition, task, snapshots)
}

// --- Human-readable description ---

export const describeCondition = (condition: AlertCondition): string => {
  if ('and' in condition) return `(${condition.and.map(describeCondition).join(' AND ')})`
  if ('or' in condition) return `(${condition.or.map(describeCondition).join(' OR ')})`
  const { field, op, value } = condition
  return value === undefined ? `${field} ${op}` : `${field} ${op} ${String(value)}`
}
