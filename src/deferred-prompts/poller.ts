import { createOpenAICompatible } from '@ai-sdk/openai-compatible'
import { generateText, stepCountIs, type ModelMessage } from 'ai'

import type { ChatProvider } from '../chat/types.js'
import { getConfig } from '../config.js'
import { nextCronOccurrence, parseCron } from '../cron.js'
import { appendHistory } from '../history.js'
import { logger } from '../logger.js'
import type { TaskProvider } from '../providers/types.js'
import { makeTools } from '../tools/index.js'
import { describeCondition, evaluateCondition, getEligibleAlertPrompts, updateAlertTriggerTime } from './alerts.js'
import { advanceScheduledPrompt, completeScheduledPrompt, getScheduledPromptsDue } from './scheduled.js'
import { getSnapshotsForUser, updateSnapshots } from './snapshots.js'
import type { ScheduledPrompt } from './types.js'

const log = logger.child({ scope: 'deferred:poller' })

/** 60 seconds */
const SCHEDULED_POLL_MS = 60_000
/** 5 minutes */
const ALERT_POLL_MS = 5 * 60_000

let scheduledIntervalId: ReturnType<typeof setInterval> | null = null
let alertIntervalId: ReturnType<typeof setInterval> | null = null

type BuildProviderFn = (userId: string) => TaskProvider | null

async function invokeLlm(
  userId: string,
  systemPrompt: string,
  userPrompt: string,
  buildProviderFn: BuildProviderFn,
): Promise<string> {
  log.debug({ userId }, 'invokeLlm called')

  const apiKey = getConfig(userId, 'llm_apikey')
  const baseURL = getConfig(userId, 'llm_baseurl')
  const mainModel = getConfig(userId, 'main_model')

  if (apiKey === null || baseURL === null || mainModel === null) {
    log.warn(
      { userId, hasApiKey: apiKey !== null, hasBaseUrl: baseURL !== null, hasModel: mainModel !== null },
      'Missing LLM config for deferred prompt',
    )
    return 'Deferred prompt skipped: missing LLM configuration. Use /set to configure llm_apikey, llm_baseurl, and main_model.'
  }

  const provider = buildProviderFn(userId)
  if (provider === null) {
    log.warn({ userId }, 'Could not build task provider for deferred prompt')
    return 'Deferred prompt skipped: task provider not configured.'
  }

  const model = createOpenAICompatible({ name: 'openai-compatible', apiKey, baseURL })(mainModel)
  const tools = makeTools(provider, userId)

  log.debug({ userId, mainModel }, 'Calling generateText for deferred prompt')
  const result = await generateText({
    model,
    system: systemPrompt,
    messages: [{ role: 'user', content: userPrompt }],
    tools,
    stopWhen: stepCountIs(25),
  })

  log.debug({ userId, toolCalls: result.toolCalls?.length }, 'Deferred prompt LLM response received')
  return result.text ?? 'Done.'
}

function logToHistory(userId: string, type: string, prompt: string, response: string): void {
  const now = new Date().toISOString()
  const systemMessage: ModelMessage = {
    role: 'user',
    content: `[Deferred Prompt] Type: ${type}\nPrompt: "${prompt}"\nTriggered at: ${now}`,
  }
  const assistantMessage: ModelMessage = {
    role: 'assistant',
    content: response,
  }
  appendHistory(userId, [systemMessage, assistantMessage])
}

function formatTaskStatus(status: string | undefined): string {
  if (status === undefined) return ''
  return ` (${status})`
}

function finalizeRecurring(prompt: ScheduledPrompt, now: string, timezone: string): void {
  const parsed = parseCron(prompt.cronExpression!)
  if (parsed === null) {
    completeScheduledPrompt(prompt.id, now)
    log.warn(
      { id: prompt.id, cronExpression: prompt.cronExpression },
      'Invalid cron expression on recurring prompt, completing',
    )
    return
  }

  const next = nextCronOccurrence(parsed, new Date(), timezone)
  if (next === null) {
    completeScheduledPrompt(prompt.id, now)
    log.warn({ id: prompt.id, userId: prompt.userId }, 'Could not compute next cron occurrence, completing prompt')
    return
  }

  advanceScheduledPrompt(prompt.id, next.toISOString(), now)
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
  const systemPrompt = [
    'You are papai, a task management assistant executing a scheduled task.',
    `User timezone: ${timezone}.`,
    'Execute the following instruction using available tools. Report results concisely.',
  ].join('\n')

  const response = await invokeLlm(prompt.userId, systemPrompt, prompt.prompt, buildProviderFn)

  await chat.sendMessage(prompt.userId, response)
  logToHistory(prompt.userId, 'scheduled', prompt.prompt, response)

  const now = new Date().toISOString()

  if (prompt.cronExpression === null) {
    completeScheduledPrompt(prompt.id, now)
    log.info({ id: prompt.id, userId: prompt.userId }, 'One-shot scheduled prompt completed')
  } else {
    finalizeRecurring(prompt, now, timezone)
  }
}

export async function pollScheduledOnce(chat: ChatProvider, buildProviderFn: BuildProviderFn): Promise<void> {
  log.debug('pollScheduledOnce called')

  const duePrompts = getScheduledPromptsDue()
  log.debug({ count: duePrompts.length }, 'Due scheduled prompts found')

  const results = await Promise.allSettled(
    duePrompts.map((prompt) => executeScheduledPrompt(prompt, chat, buildProviderFn)),
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
  fullTasks: Awaited<ReturnType<TaskProvider['getTask']>>[],
  snapshots: Map<string, string>,
  chat: ChatProvider,
  buildProviderFn: BuildProviderFn,
): Promise<void> {
  const matchedTasks = fullTasks.filter((task) => evaluateCondition(alert.condition, task, snapshots))
  if (matchedTasks.length === 0) return

  const timezone = getConfig(userId, 'timezone') ?? 'UTC'
  const conditionDesc = describeCondition(alert.condition)
  const taskList = matchedTasks.map((t) => `- [${t.title}](${t.url})${formatTaskStatus(t.status)}`).join('\n')

  const systemPrompt = [
    'You are papai, a task management assistant executing an alert check.',
    `User timezone: ${timezone}.`,
    'An alert condition has been triggered. Summarize the situation concisely.',
  ].join('\n')
  const userPrompt = `Alert condition: ${conditionDesc}\n\nMatched tasks:\n${taskList}\n\nOriginal instruction: "${alert.prompt}"`

  const response = await invokeLlm(userId, systemPrompt, userPrompt, buildProviderFn)

  await chat.sendMessage(userId, response)
  logToHistory(userId, 'alert', alert.prompt, response)

  const now = new Date().toISOString()
  updateAlertTriggerTime(alert.id, now)
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

  const tasks = await provider.searchTasks({ query: '', limit: 200 })
  const snapshots = getSnapshotsForUser(userId)
  const fullTasks = await Promise.all(tasks.map((t) => provider.getTask(t.id)))

  const alertResults = await Promise.allSettled(
    alerts.map((alert) => executeSingleAlert(alert, userId, fullTasks, snapshots, chat, buildProviderFn)),
  )

  for (const result of alertResults) {
    if (result.status === 'rejected') {
      log.error({ userId, error: String(result.reason) }, 'Error evaluating alert')
    }
  }

  updateSnapshots(userId, fullTasks)
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

  const results = await Promise.allSettled(
    [...byUser.entries()].map(([userId, alerts]) => executeAlertsForUser(userId, alerts, chat, buildProviderFn)),
  )

  for (const result of results) {
    if (result.status === 'rejected') {
      log.error({ error: String(result.reason) }, 'Error polling alerts for user')
    }
  }
}

export function startPollers(chat: ChatProvider, buildProviderFn: BuildProviderFn): void {
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
