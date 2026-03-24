import pLimit from 'p-limit'

import type { ChatProvider } from '../chat/types.js'
import { getConfig } from '../config.js'
import { nextCronOccurrence, parseCron } from '../cron.js'
import { logger } from '../logger.js'
import type { Task } from '../providers/types.js'
import { describeCondition, evaluateCondition, getEligibleAlertPrompts, updateAlertTriggerTime } from './alerts.js'
import { alertsNeedFullTasks, enrichTasks, fetchAllTasks } from './fetch-tasks.js'
import { buildProactiveTrigger, invokeLlmWithHistory, type BuildProviderFn } from './proactive-llm.js'
import { advanceScheduledPrompt, completeScheduledPrompt, getScheduledPromptsDue } from './scheduled.js'
import { getSnapshotsForUser, updateSnapshots } from './snapshots.js'
import type { ScheduledPrompt } from './types.js'

const log = logger.child({ scope: 'deferred:poller' })

/** 60 seconds */
const SCHEDULED_POLL_MS = 60_000
/** 5 minutes */
const ALERT_POLL_MS = 5 * 60_000

/** Max concurrent LLM invocations per poll cycle. */
const MAX_CONCURRENT_LLM_CALLS = 5
/** Max concurrent user alert evaluations per poll cycle. */
const MAX_CONCURRENT_USERS = 10

let scheduledIntervalId: ReturnType<typeof setInterval> | null = null
let alertIntervalId: ReturnType<typeof setInterval> | null = null

function formatTaskStatus(status: string | undefined): string {
  if (status === undefined) return ''
  return ` (${status})`
}

function finalizeRecurring(prompt: ScheduledPrompt, now: string, timezone: string): void {
  const parsed = parseCron(prompt.cronExpression!)
  if (parsed === null) {
    completeScheduledPrompt(prompt.id, prompt.userId, now)
    log.warn(
      { id: prompt.id, cronExpression: prompt.cronExpression },
      'Invalid cron expression on recurring prompt, completing',
    )
    return
  }
  const next = nextCronOccurrence(parsed, new Date(), timezone)
  if (next === null) {
    completeScheduledPrompt(prompt.id, prompt.userId, now)
    log.warn({ id: prompt.id, userId: prompt.userId }, 'Could not compute next cron occurrence, completing prompt')
    return
  }

  advanceScheduledPrompt(prompt.id, prompt.userId, next.toISOString(), now)
  log.info(
    { id: prompt.id, userId: prompt.userId, nextFireAt: next.toISOString() },
    'Recurring scheduled prompt advanced',
  )
}

async function executeScheduledPrompt(
  prompt: ScheduledPrompt,
  chat: ChatProvider,
  buildProviderFn: BuildProviderFn,
): Promise<void> {
  const timezone = getConfig(prompt.userId, 'timezone') ?? 'UTC'
  const triggerContent = buildProactiveTrigger('scheduled', prompt.prompt, timezone)

  let response: string
  try {
    response = await invokeLlmWithHistory(prompt.userId, triggerContent, buildProviderFn)
    await chat.sendMessage(prompt.userId, response)
  } catch (error) {
    const errMsg = error instanceof Error ? error.message : String(error)
    log.error({ id: prompt.id, userId: prompt.userId, error: errMsg }, 'Scheduled prompt LLM invocation failed')
    response = `Failed: ${errMsg}`
    await chat.sendMessage(prompt.userId, `Scheduled task failed: ${errMsg}`)
  }

  const now = new Date().toISOString()
  if (prompt.cronExpression === null) {
    completeScheduledPrompt(prompt.id, prompt.userId, now)
    log.info({ id: prompt.id, userId: prompt.userId }, 'One-shot scheduled prompt completed')
  } else {
    finalizeRecurring(prompt, now, timezone)
  }
}

export async function pollScheduledOnce(chat: ChatProvider, buildProviderFn: BuildProviderFn): Promise<void> {
  log.debug('pollScheduledOnce called')

  const duePrompts = getScheduledPromptsDue()
  log.debug({ count: duePrompts.length }, 'Due scheduled prompts found')

  const limit = pLimit(MAX_CONCURRENT_LLM_CALLS)
  const results = await Promise.allSettled(
    duePrompts.map((prompt) => limit((): Promise<void> => executeScheduledPrompt(prompt, chat, buildProviderFn))),
  )

  for (const result of results) {
    if (result.status === 'rejected') {
      log.error({ error: String(result.reason) }, 'Error executing scheduled prompt')
    }
  }
}

async function executeSingleAlert(
  alert: ReturnType<typeof getEligibleAlertPrompts>[number],
  userId: string,
  tasks: Task[],
  snapshots: Map<string, string>,
  chat: ChatProvider,
  buildProviderFn: BuildProviderFn,
): Promise<void> {
  const matchedTasks = tasks.filter((task) => evaluateCondition(alert.condition, task, snapshots))
  if (matchedTasks.length === 0) return

  const timezone = getConfig(userId, 'timezone') ?? 'UTC'
  const conditionDesc = describeCondition(alert.condition)
  const taskList = matchedTasks.map((t) => `- [${t.title}](${t.url})${formatTaskStatus(t.status)}`).join('\n')
  const matchedTasksSummary = `Alert condition: ${conditionDesc}\n${taskList}`
  const triggerContent = buildProactiveTrigger('alert', alert.prompt, timezone, matchedTasksSummary)

  let response: string
  try {
    response = await invokeLlmWithHistory(userId, triggerContent, buildProviderFn)
    await chat.sendMessage(userId, response)
  } catch (error) {
    const errMsg = error instanceof Error ? error.message : String(error)
    log.error({ id: alert.id, userId, error: errMsg }, 'Alert prompt LLM invocation failed')
    response = `Failed: ${errMsg}`
    await chat.sendMessage(userId, `Alert task failed: ${errMsg}`)
  }

  const now = new Date().toISOString()
  updateAlertTriggerTime(alert.id, userId, now)
  log.info({ id: alert.id, userId, matchedCount: matchedTasks.length }, 'Alert triggered')
}

async function executeAlertsForUser(
  userId: string,
  alerts: ReturnType<typeof getEligibleAlertPrompts>,
  chat: ChatProvider,
  buildProviderFn: BuildProviderFn,
): Promise<void> {
  const provider = buildProviderFn(userId)
  if (provider === null) {
    log.warn({ userId }, 'Could not build task provider for alert polling')
    return
  }

  let tasks = await fetchAllTasks(provider)
  const snapshots = getSnapshotsForUser(userId)

  if (tasks.length > 0 && alertsNeedFullTasks(alerts)) {
    log.debug({ userId, taskCount: tasks.length }, 'Enriching tasks with full details for alert conditions')
    tasks = await enrichTasks(provider, tasks)
  }

  const alertLimit = pLimit(MAX_CONCURRENT_LLM_CALLS)
  const alertResults = await Promise.allSettled(
    alerts.map((alert) =>
      alertLimit((): Promise<void> => executeSingleAlert(alert, userId, tasks, snapshots, chat, buildProviderFn)),
    ),
  )

  for (const result of alertResults) {
    if (result.status === 'rejected') {
      log.error({ userId, error: String(result.reason) }, 'Error evaluating alert')
    }
  }

  updateSnapshots(userId, tasks)
}

export async function pollAlertsOnce(chat: ChatProvider, buildProviderFn: BuildProviderFn): Promise<void> {
  log.debug('pollAlertsOnce called')

  const eligibleAlerts = getEligibleAlertPrompts()
  log.debug({ count: eligibleAlerts.length }, 'Eligible alert prompts found')

  if (eligibleAlerts.length === 0) return

  const byUser = new Map<string, typeof eligibleAlerts>()
  for (const alert of eligibleAlerts) {
    const existing = byUser.get(alert.userId)
    if (existing === undefined) {
      byUser.set(alert.userId, [alert])
    } else {
      existing.push(alert)
    }
  }

  const userLimit = pLimit(MAX_CONCURRENT_USERS)
  const results = await Promise.allSettled(
    [...byUser.entries()].map(([userId, alerts]) =>
      userLimit((): Promise<void> => executeAlertsForUser(userId, alerts, chat, buildProviderFn)),
    ),
  )

  for (const result of results) {
    if (result.status === 'rejected') {
      log.error({ error: String(result.reason) }, 'Error polling alerts for user')
    }
  }
}

export function startPollers(chat: ChatProvider, buildProviderFn: BuildProviderFn): void {
  if (scheduledIntervalId !== null || alertIntervalId !== null) {
    log.warn('startPollers called while pollers are already running; stopping existing pollers first')
    stopPollers()
  }

  log.info({ scheduledPollMs: SCHEDULED_POLL_MS, alertPollMs: ALERT_POLL_MS }, 'Starting deferred prompt pollers')

  void pollScheduledOnce(chat, buildProviderFn)
  void pollAlertsOnce(chat, buildProviderFn)

  scheduledIntervalId = setInterval(() => {
    void pollScheduledOnce(chat, buildProviderFn)
  }, SCHEDULED_POLL_MS)

  alertIntervalId = setInterval(() => {
    void pollAlertsOnce(chat, buildProviderFn)
  }, ALERT_POLL_MS)
}

export function stopPollers(): void {
  log.info('Stopping deferred prompt pollers')

  if (scheduledIntervalId !== null) {
    clearInterval(scheduledIntervalId)
    scheduledIntervalId = null
  }

  if (alertIntervalId !== null) {
    clearInterval(alertIntervalId)
    alertIntervalId = null
  }
}
