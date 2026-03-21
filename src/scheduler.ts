/**
 * Recurring task scheduler.
 *
 * Runs on a 60-second interval, checks for due recurring tasks,
 * and creates new task instances via the task provider.
 */

import type { ChatProvider } from './chat/types.js'
import { getConfig } from './config.js'
import { logger } from './logger.js'
import { createProvider } from './providers/registry.js'
import type { TaskProvider } from './providers/types.js'
import type { Task } from './providers/types.js'
import { type RecurringTaskRecord, getDueRecurringTasks, markExecuted } from './recurring.js'
import { getKaneoWorkspace } from './users.js'

const log = logger.child({ scope: 'scheduler' })

/** Scheduler tick interval: 60 seconds */
const TICK_INTERVAL_MS = 60 * 1000

let intervalId: ReturnType<typeof setInterval> | null = null
let chatProviderRef: ChatProvider | null = null
let isTickRunning = false

const TASK_PROVIDER = process.env['TASK_PROVIDER'] ?? 'kaneo'

const buildProviderForUser = (userId: string): TaskProvider | null => {
  log.debug({ userId, providerName: TASK_PROVIDER }, 'Building provider for scheduled task')

  if (TASK_PROVIDER === 'kaneo') {
    const kaneoKey = getConfig(userId, 'kaneo_apikey')
    const kaneoBaseUrl = process.env['KANEO_CLIENT_URL']
    const workspaceId = getKaneoWorkspace(userId)

    if (kaneoKey === null || kaneoBaseUrl === undefined || kaneoBaseUrl === '' || workspaceId === null) {
      log.warn({ userId }, 'Missing Kaneo config for scheduled task')
      return null
    }

    const isSessionCookie = kaneoKey.startsWith('better-auth.session_token=')
    const config: Record<string, string> = isSessionCookie
      ? { baseUrl: kaneoBaseUrl, sessionCookie: kaneoKey, workspaceId }
      : { apiKey: kaneoKey, baseUrl: kaneoBaseUrl, workspaceId }

    return createProvider('kaneo', config)
  }

  if (TASK_PROVIDER === 'youtrack') {
    const baseUrl = process.env['YOUTRACK_URL']
    const token = getConfig(userId, 'youtrack_token')

    if (baseUrl === undefined || baseUrl === '' || token === null) {
      log.warn({ userId }, 'Missing YouTrack config for scheduled task')
      return null
    }

    return createProvider('youtrack', { baseUrl, token })
  }

  log.warn({ userId, providerName: TASK_PROVIDER }, 'Unknown task provider')
  return null
}

const applyLabels = async (provider: TaskProvider, taskId: string, labels: readonly string[]): Promise<void> => {
  if (labels.length === 0) return
  if (!provider.capabilities.has('labels.assign') || provider.addTaskLabel === undefined) return

  const results = await Promise.allSettled(labels.map((labelId) => provider.addTaskLabel!(taskId, labelId)))

  for (let i = 0; i < results.length; i++) {
    const result = results[i]!
    if (result.status === 'fulfilled') {
      log.debug({ taskId, labelId: labels[i] }, 'Label applied to recurring task instance')
    } else {
      log.warn({ taskId, labelId: labels[i], error: result.reason }, 'Failed to apply label')
    }
  }
}

const notifyUser = async (userId: string, created: Task): Promise<void> => {
  if (chatProviderRef === null) return
  try {
    await chatProviderRef.sendMessage(userId, `Recurring task created: **${created.title}** in project.`)
  } catch (notifyError) {
    log.warn(
      { userId, error: notifyError instanceof Error ? notifyError.message : String(notifyError) },
      'Failed to notify user about recurring task',
    )
  }
}

const executeRecurringTask = async (task: RecurringTaskRecord): Promise<void> => {
  log.debug({ taskId: task.id, title: task.title, userId: task.userId }, 'Executing recurring task')

  const provider = buildProviderForUser(task.userId)
  if (provider === null) {
    log.error({ taskId: task.id, userId: task.userId }, 'Cannot build provider for recurring task')
    return
  }

  try {
    const created = await provider.createTask({
      projectId: task.projectId,
      title: task.title,
      description: task.description ?? undefined,
      priority: task.priority ?? undefined,
      status: task.status ?? undefined,
      assignee: task.assignee ?? undefined,
    })

    log.info(
      { recurringTaskId: task.id, createdTaskId: created.id, title: task.title },
      'Recurring task instance created',
    )

    await applyLabels(provider, created.id, task.labels)
    markExecuted(task.id)
    await notifyUser(task.userId, created)
  } catch (error) {
    log.error(
      { taskId: task.id, error: error instanceof Error ? error.message : String(error) },
      'Failed to create recurring task instance',
    )
  }
}

const tick = async (): Promise<void> => {
  if (isTickRunning) {
    log.debug('Skipping scheduler tick: previous tick still in progress')
    return
  }

  isTickRunning = true
  try {
    const dueTasks = getDueRecurringTasks()
    if (dueTasks.length === 0) return

    log.info({ count: dueTasks.length }, 'Processing due recurring tasks')

    await dueTasks.reduce<Promise<void>>(
      (chain, task) => chain.then(() => executeRecurringTask(task)),
      Promise.resolve(),
    )
  } catch (error) {
    log.error({ error: error instanceof Error ? error.message : String(error) }, 'Scheduler tick failed')
  } finally {
    isTickRunning = false
  }
}

export const startScheduler = (chatProvider: ChatProvider): void => {
  if (intervalId !== null) {
    log.warn('Scheduler already running')
    return
  }

  chatProviderRef = chatProvider
  log.info({ intervalMs: TICK_INTERVAL_MS }, 'Starting recurring task scheduler')
  intervalId = setInterval(() => void tick(), TICK_INTERVAL_MS)

  // Run immediately on start to catch any overdue tasks
  void tick()
}

export const stopScheduler = (): void => {
  if (intervalId !== null) {
    clearInterval(intervalId)
    intervalId = null
    chatProviderRef = null
    isTickRunning = false
    log.info('Scheduler stopped')
  }
}
