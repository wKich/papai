/**
 * Proactive alert scheduler.
 *
 * Manages three types of scheduled jobs:
 * 1. Per-user briefing jobs (run at user-configured time in their timezone)
 * 2. Global alert poller (runs hourly)
 * 3. Global reminder poller (every minute)
 */

import type { ChatProvider } from '../chat/types.js'
import { getConfig } from '../config.js'
import { parseCron, nextCronOccurrence } from '../cron.js'
import { logger } from '../logger.js'
import type { TaskProvider } from '../providers/types.js'
import { listUsers } from '../users.js'
import * as briefingService from './briefing.js'
import * as reminderService from './reminders.js'
import * as alertService from './service.js'

const log = logger.child({ scope: 'proactive:scheduler' })

const REMINDER_POLL_INTERVAL_MS = 60 * 1000
/** Check hourly, but only act once per day */
const ALERT_POLL_INTERVAL_MS = 60 * 60 * 1000

type BriefingJob = {
  userId: string
  intervalId: ReturnType<typeof setInterval>
  cronExpression: string
  timezone: string
  nextRun: Date | null
}

let reminderPollerId: ReturnType<typeof setInterval> | null = null
let alertPollerId: ReturnType<typeof setInterval> | null = null
const briefingJobs = new Map<string, BriefingJob>()
let chatRef: ChatProvider | null = null
let buildProviderFn: ((userId: string) => TaskProvider | null) | null = null
let isStarted = false

/**
 * Convert "HH:MM" to a cron expression for daily execution.
 */
function cronFromTime(time: string): string {
  const [hour, minute] = time.split(':')
  return `${minute} ${hour} * * *`
}

export function registerBriefingJob(userId: string, time: string, timezone: string): void {
  log.debug({ userId, time, timezone }, 'registerBriefingJob called')

  // Stop existing job for this user if any
  unregisterBriefingJob(userId)

  const cronExpr = cronFromTime(time)
  const parsed = parseCron(cronExpr)
  if (parsed === null) {
    log.warn({ userId, time, cronExpr }, 'Invalid briefing cron expression')
    return
  }

  const nextRun = nextCronOccurrence(parsed, new Date(), timezone)

  // Check every minute if it's time to fire
  const intervalId = setInterval(() => {
    void fireBriefingIfDue(userId, cronExpr, timezone)
  }, REMINDER_POLL_INTERVAL_MS)

  briefingJobs.set(userId, {
    userId,
    intervalId,
    cronExpression: cronExpr,
    timezone,
    nextRun,
  })

  log.info({ userId, time, timezone, nextRun: nextRun?.toISOString() }, 'Briefing job registered')
}

async function fireBriefingIfDue(userId: string, cronExpr: string, timezone: string): Promise<void> {
  const job = briefingJobs.get(userId)
  if (job === undefined || job.nextRun === null) return
  if (Date.now() < job.nextRun.getTime()) return

  try {
    if (chatRef === null || buildProviderFn === null) return

    const provider = buildProviderFn(userId)
    if (provider === null) {
      log.warn({ userId }, 'Cannot build provider for briefing')
      return
    }

    const mode = getConfig(userId, 'briefing_mode') === 'short' ? 'short' : 'full'
    const content = await briefingService.generateAndRecord(userId, provider, mode)
    await chatRef.sendMessage(userId, content)

    log.info({ userId }, 'Scheduled briefing delivered')
  } catch (error) {
    log.error(
      { userId, error: error instanceof Error ? error.message : String(error) },
      'Failed to deliver scheduled briefing',
    )
  }

  // Advance to next occurrence
  const parsed = parseCron(cronExpr)
  if (parsed !== null) {
    job.nextRun = nextCronOccurrence(parsed, new Date(), timezone)
  }
}

export function unregisterBriefingJob(userId: string): void {
  const existing = briefingJobs.get(userId)
  if (existing === undefined) return

  clearInterval(existing.intervalId)
  briefingJobs.delete(userId)
  log.info({ userId }, 'Briefing job unregistered')
}

const deliverReminder = async (reminder: ReturnType<typeof reminderService.fetchDue>[number]): Promise<void> => {
  if (chatRef === null) return
  try {
    await chatRef.sendMessage(reminder.userId, `🔔 **Reminder:** ${reminder.text}`)
    reminderService.markDelivered(reminder.id)

    if (reminder.recurrence !== null) {
      reminderService.advanceRecurrence(reminder.id)
      log.debug({ reminderId: reminder.id }, 'Recurring reminder advanced')
    }

    log.info({ reminderId: reminder.id, userId: reminder.userId }, 'Reminder delivered')
  } catch (error) {
    log.error(
      { reminderId: reminder.id, error: error instanceof Error ? error.message : String(error) },
      'Failed to deliver reminder',
    )
  }
}

async function pollReminders(): Promise<void> {
  if (chatRef === null) return

  try {
    const due = reminderService.fetchDue()
    if (due.length === 0) return

    log.debug({ count: due.length }, 'Processing due reminders')

    await due.reduce<Promise<void>>((chain, reminder) => chain.then(() => deliverReminder(reminder)), Promise.resolve())
  } catch (error) {
    log.error({ error: error instanceof Error ? error.message : String(error) }, 'Reminder poll failed')
  }
}

async function pollAlerts(): Promise<void> {
  if (chatRef === null || buildProviderFn === null) return

  try {
    await alertService.runAlertCycleForAllUsers(buildProviderFn, (userId: string, message: string) =>
      chatRef!.sendMessage(userId, message),
    )
  } catch (error) {
    log.error({ error: error instanceof Error ? error.message : String(error) }, 'Alert poll failed')
  }
}

export function start(chat: ChatProvider, providerBuilder: (userId: string) => TaskProvider | null): void {
  if (isStarted) {
    log.warn('Proactive scheduler already running')
    return
  }

  chatRef = chat
  buildProviderFn = providerBuilder
  isStarted = true

  // Register reminder poller (every minute)
  reminderPollerId = setInterval(() => void pollReminders(), REMINDER_POLL_INTERVAL_MS)

  // Register alert poller (hourly)
  alertPollerId = setInterval(() => void pollAlerts(), ALERT_POLL_INTERVAL_MS)

  // Register per-user briefing jobs
  let briefingCount = 0
  const allUsers = listUsers()
  for (const user of allUsers) {
    const userId = user.platform_user_id
    const briefingTime = getConfig(userId, 'briefing_time')
    const briefingTz = getConfig(userId, 'briefing_timezone') ?? getConfig(userId, 'timezone') ?? 'UTC'

    if (briefingTime !== null) {
      registerBriefingJob(userId, briefingTime, briefingTz)
      briefingCount++
    }
  }

  // Run initial polls immediately
  void pollReminders()
  void pollAlerts()

  log.info({ briefingJobs: briefingCount, globalPollers: 2 }, 'Proactive alert scheduler started')
}

export function stopAll(): void {
  if (reminderPollerId !== null) {
    clearInterval(reminderPollerId)
    reminderPollerId = null
  }
  if (alertPollerId !== null) {
    clearInterval(alertPollerId)
    alertPollerId = null
  }

  for (const [userId, job] of briefingJobs) {
    clearInterval(job.intervalId)
    briefingJobs.delete(userId)
  }

  chatRef = null
  buildProviderFn = null
  isStarted = false

  log.info('Proactive scheduler stopped')
}

/**
 * Get the number of active briefing jobs.
 * @internal
 */
export function getBriefingJobCount(): number {
  return briefingJobs.size
}

/** @internal — test-only */
export function _pollReminders(): Promise<void> {
  return pollReminders()
}

/** @internal — test-only */
export function _pollAlerts(): Promise<void> {
  return pollAlerts()
}

/** @internal — test-only */
export function _fireBriefingIfDue(userId: string, cronExpr: string, timezone: string): Promise<void> {
  return fireBriefingIfDue(userId, cronExpr, timezone)
}

/** @internal — test-only: returns the live briefingJobs map so tests can manipulate nextRun */
export function _getBriefingJobs(): Map<string, BriefingJob> {
  return briefingJobs
}
