import { and, eq } from 'drizzle-orm'

import { getConfig } from '../config.js'
import { getDrizzleDb } from '../db/drizzle.js'
import { alertState } from '../db/schema.js'
import { logger } from '../logger.js'
import type { TaskProvider, TaskListItem } from '../providers/types.js'
import { listUsers } from '../users.js'
import { fetchAllTasks, isTerminalStatus } from './shared.js'
import type { AlertCheckResult, AlertType } from './types.js'

const log = logger.child({ scope: 'proactive:alerts' })

/** Suppression windows in milliseconds */
const SUPPRESSION_MS: Record<AlertType, number> = {
  deadline_nudge: 20 * 60 * 60 * 1000,
  due_today: 20 * 60 * 60 * 1000,
  overdue: 20 * 60 * 60 * 1000,
  staleness: 72 * 60 * 60 * 1000,
  blocked: 20 * 60 * 60 * 1000,
}

const generateId = (): string => crypto.randomUUID()

const formatDateInTz = (date: Date, timezone: string): string => {
  try {
    return new Intl.DateTimeFormat('en-CA', {
      timeZone: timezone,
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
    }).format(date)
  } catch {
    return date.toISOString().slice(0, 10)
  }
}

const getTodayInTz = (timezone: string): string => formatDateInTz(new Date(), timezone)

const getTomorrowInTz = (timezone: string): string =>
  formatDateInTz(new Date(Date.now() + 24 * 60 * 60 * 1000), timezone)

const isSuppressed = (userId: string, taskId: string, alertType: AlertType): boolean => {
  const db = getDrizzleDb()
  const row = db
    .select()
    .from(alertState)
    .where(and(eq(alertState.userId, userId), eq(alertState.taskId, taskId)))
    .get()

  if (row === undefined) return false
  if (row.lastAlertType !== alertType) return false
  if (row.suppressUntil === null) return false

  return new Date(row.suppressUntil).getTime() > Date.now()
}

const taskLink = (task: TaskListItem): string => (task.url === undefined ? task.title : `[${task.title}](${task.url})`)

function insertNewAlertState(
  userId: string,
  taskId: string,
  currentStatus: string,
  now: string,
  alertType?: AlertType,
): void {
  const db = getDrizzleDb()
  const suppressUntil = alertType === undefined ? null : new Date(Date.now() + SUPPRESSION_MS[alertType]).toISOString()

  db.insert(alertState)
    .values({
      id: generateId(),
      userId,
      taskId,
      lastSeenStatus: currentStatus,
      lastStatusChangedAt: now,
      lastAlertType: alertType ?? null,
      lastAlertSentAt: alertType === undefined ? null : now,
      suppressUntil,
      overdueDaysNotified: alertType === 'overdue' ? 1 : 0,
    })
    .run()
}

export function updateAlertState(userId: string, taskId: string, currentStatus: string, alertType?: AlertType): void {
  log.debug({ userId, taskId, currentStatus, alertType }, 'updateAlertState called')
  const db = getDrizzleDb()

  const existing = db
    .select()
    .from(alertState)
    .where(and(eq(alertState.userId, userId), eq(alertState.taskId, taskId)))
    .get()

  const now = new Date().toISOString()

  if (existing === undefined) {
    insertNewAlertState(userId, taskId, currentStatus, now, alertType)
    return
  }

  const statusChanged = existing.lastSeenStatus !== currentStatus
  const updates: Partial<typeof alertState.$inferInsert> = { lastSeenStatus: currentStatus }

  if (statusChanged) {
    updates.lastStatusChangedAt = now
    updates.overdueDaysNotified = 0
  }

  if (alertType !== undefined) {
    updates.lastAlertType = alertType
    updates.lastAlertSentAt = now
    updates.suppressUntil = new Date(Date.now() + SUPPRESSION_MS[alertType]).toISOString()

    if (alertType === 'overdue') {
      const previous = statusChanged ? 0 : (existing.overdueDaysNotified ?? 0)
      updates.overdueDaysNotified = previous + 1
    }
  }

  db.update(alertState).set(updates).where(eq(alertState.id, existing.id)).run()
}

export function checkDeadlineNudge(userId: string, task: TaskListItem, timezone: string): string | null {
  log.debug({ userId, taskId: task.id }, 'checkDeadlineNudge called')

  if (task.dueDate === undefined || task.dueDate === null) return null
  if (isTerminalStatus(task.status)) return null
  if (task.dueDate.slice(0, 10) !== getTomorrowInTz(timezone)) return null
  if (isSuppressed(userId, task.id, 'deadline_nudge')) return null

  updateAlertState(userId, task.id, task.status ?? 'unknown', 'deadline_nudge')
  return `📅 ${taskLink(task)} is due tomorrow. Make sure it's on track.`
}

export function checkDueToday(userId: string, task: TaskListItem, timezone: string): string | null {
  log.debug({ userId, taskId: task.id }, 'checkDueToday called')

  if (task.dueDate === undefined || task.dueDate === null) return null
  if (isTerminalStatus(task.status)) return null
  if (task.dueDate.slice(0, 10) !== getTodayInTz(timezone)) return null
  if (isSuppressed(userId, task.id, 'due_today')) return null

  updateAlertState(userId, task.id, task.status ?? 'unknown', 'due_today')
  return `⏰ ${taskLink(task)} is due today.`
}

export function checkOverdue(userId: string, task: TaskListItem, timezone: string): string | null {
  log.debug({ userId, taskId: task.id }, 'checkOverdue called')

  if (task.dueDate === undefined || task.dueDate === null) return null
  if (isTerminalStatus(task.status)) return null

  const today = getTodayInTz(timezone)
  const taskDue = task.dueDate.slice(0, 10)
  if (taskDue >= today) return null
  if (isSuppressed(userId, task.id, 'overdue')) return null

  const daysOverdue = Math.floor((new Date(today).getTime() - new Date(taskDue).getTime()) / (24 * 60 * 60 * 1000))
  const db = getDrizzleDb()
  const existing = db
    .select()
    .from(alertState)
    .where(and(eq(alertState.userId, userId), eq(alertState.taskId, task.id)))
    .get()

  const priorNotifications = existing?.overdueDaysNotified ?? 0
  updateAlertState(userId, task.id, task.status ?? 'unknown', 'overdue')

  const link = taskLink(task)
  const dayWord = daysOverdue === 1 ? 'day' : 'days'

  if (priorNotifications < 3) {
    return `⚠️ ${link} is ${daysOverdue} ${dayWord} overdue. Please update its status.`
  }
  if (priorNotifications < 6) {
    return `🔴 ${link} is ${daysOverdue} ${dayWord} overdue. Please resolve or escalate.`
  }
  return `🚨 ${link} is now ${daysOverdue} ${dayWord} overdue. Immediate action required.`
}

export function checkStaleness(userId: string, task: TaskListItem, thresholdDays: number): string | null {
  log.debug({ userId, taskId: task.id, thresholdDays }, 'checkStaleness called')

  if (isTerminalStatus(task.status)) return null
  if (isSuppressed(userId, task.id, 'staleness')) return null

  const db = getDrizzleDb()
  const existing = db
    .select()
    .from(alertState)
    .where(and(eq(alertState.userId, userId), eq(alertState.taskId, task.id)))
    .get()

  if (existing === undefined) {
    updateAlertState(userId, task.id, task.status ?? 'unknown')
    return null
  }

  if (existing.lastStatusChangedAt === null) return null

  const daysSinceChange = Math.floor(
    (Date.now() - new Date(existing.lastStatusChangedAt).getTime()) / (24 * 60 * 60 * 1000),
  )

  if (daysSinceChange < thresholdDays) return null

  updateAlertState(userId, task.id, task.status ?? 'unknown', 'staleness')
  return `🕸️ ${taskLink(task)} has been in "${task.status ?? 'unknown'}" for ${daysSinceChange} days with no activity.`
}

export async function checkBlocked(
  userId: string,
  task: TaskListItem,
  timezone: string,
  provider: TaskProvider,
): Promise<string | null> {
  log.debug({ userId, taskId: task.id }, 'checkBlocked called')

  if (task.dueDate === undefined || task.dueDate === null) return null
  if (isTerminalStatus(task.status)) return null
  if (task.dueDate.slice(0, 10) > getTomorrowInTz(timezone)) return null
  if (isSuppressed(userId, task.id, 'blocked')) return null
  if (!provider.capabilities.has('tasks.relations') || provider.getTask === undefined) return null

  const fullTask = await provider.getTask(task.id)
  const blockedByRelations = fullTask.relations?.filter((r) => r.type === 'blocked_by') ?? []
  if (blockedByRelations.length === 0) return null

  const blockerDetails = await Promise.allSettled(blockedByRelations.map((r) => provider.getTask(r.taskId)))
  const activeBlockers = blockerDetails.flatMap((r) => {
    if (r.status === 'fulfilled' && !isTerminalStatus(r.value.status)) return [r.value]
    return []
  })
  if (activeBlockers.length === 0) return null

  const blocker = activeBlockers[0]!
  updateAlertState(userId, task.id, task.status ?? 'unknown', 'blocked')
  return `🚧 ${taskLink(task)} is due in ≤1 day but blocked by [${blocker.title}](${blocker.url ?? '#'}), which is still "${blocker.status ?? 'unknown'}".`
}

export async function runAlertCycle(
  userId: string,
  provider: TaskProvider,
  sendFn: (userId: string, message: string) => Promise<void>,
): Promise<AlertCheckResult> {
  const result: AlertCheckResult = { sent: 0, suppressed: 0 }
  const timezone = getConfig(userId, 'briefing_timezone') ?? getConfig(userId, 'timezone') ?? 'UTC'
  const rawStaleness = Number.parseInt(getConfig(userId, 'staleness_days') ?? '7', 10)
  const stalenessDays = Number.isFinite(rawStaleness) && rawStaleness >= 1 ? rawStaleness : 7
  try {
    const allTasks = await fetchAllTasks(provider, { userId })
    const syncAlerts = allTasks.flatMap((task) =>
      [
        checkDeadlineNudge(userId, task, timezone),
        checkDueToday(userId, task, timezone),
        checkOverdue(userId, task, timezone),
        checkStaleness(userId, task, stalenessDays),
      ].filter((a): a is string => a !== null),
    )

    const blockedResults = await Promise.all(allTasks.map((task) => checkBlocked(userId, task, timezone, provider)))
    const blockedAlerts = blockedResults.filter((msg): msg is string => msg !== null)
    const allAlerts = [...syncAlerts, ...blockedAlerts]

    await allAlerts.reduce(
      (chain, alert) =>
        chain.then(async () => {
          try {
            await sendFn(userId, alert)
            result.sent++
          } catch (err) {
            log.error({ userId, error: err instanceof Error ? err.message : String(err) }, 'Failed to send alert')
          }
        }),
      Promise.resolve(),
    )
    log.info({ userId, sent: result.sent }, 'Alert cycle completed')
  } catch (error) {
    log.error({ userId, error: error instanceof Error ? error.message : String(error) }, 'Alert cycle failed')
  }
  return result
}

export async function runAlertCycleForAllUsers(
  buildProviderFn: (userId: string) => TaskProvider | null,
  sendFn: (userId: string, message: string) => Promise<void>,
): Promise<void> {
  const eligible = listUsers().filter((u) => getConfig(u.platform_user_id, 'deadline_nudges') === 'enabled')
  await eligible.reduce((chain, user) => {
    const p = buildProviderFn(user.platform_user_id)
    if (p === null) {
      log.warn({ userId: user.platform_user_id }, 'Cannot build provider')
      return chain
    }
    return chain.then(() => runAlertCycle(user.platform_user_id, p, sendFn).then(() => {}))
  }, Promise.resolve())
}
