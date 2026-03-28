/**
 * Internal scheduler implementation details.
 *
 * This module contains the internal types, defaults, and helper functions
 * used by the main scheduler. Separated to reduce file size and improve
 * maintainability.
 */

import { logger } from '../logger.js'
import { FatalError, RetryableError, SchedulerError } from './scheduler.errors.js'
import { getErrorMessage, getErrorObject, type Emitters, type Task } from './scheduler.helpers.js'
import type { SchedulerOptions } from './scheduler.types.js'

/**
 * Handle successful task execution.
 */
const handleTaskSuccess = (task: Task, startTime: number, emitters: Emitters): void => {
  const duration = Date.now() - startTime
  const timestamp = new Date(startTime)
  task.lastRun = timestamp
  task.retryAttempt = 0

  emitters.emitTick({
    name: task.name,
    duration,
    timestamp,
  })

  logger.info({ taskName: task.name, duration }, 'Task executed successfully')
}

/**
 * Schedule a retry for a failed task.
 */
const scheduleRetry = (
  task: Task,
  schedulerOptions: Required<SchedulerOptions>,
  emitters: Emitters,
  stopTask: (name: string) => void,
): void => {
  task.retryAttempt++
  const maxRetryDelay = schedulerOptions.maxRetryDelay
  const baseDelay = Math.min(2 ** task.retryAttempt * 1000, maxRetryDelay)
  const jitter = baseDelay * 0.1 * Math.random()
  const delay = Math.floor(baseDelay + jitter)

  logger.warn(
    {
      taskName: task.name,
      attempt: task.retryAttempt,
      delay,
      maxRetries: task.options.retries,
    },
    'Scheduling retry with backoff',
  )

  emitters.emitRetry({
    name: task.name,
    attempt: task.retryAttempt,
    delay,
    timestamp: new Date(),
  })

  task.retryTimeoutId = setTimeout(() => {
    task.retryTimeoutId = null
    // Only execute if task is still running
    if (task.running) {
      void executeTask(task, schedulerOptions, emitters, stopTask)
    }
  }, delay)

  if (task.options.unref && task.retryTimeoutId !== null) {
    task.retryTimeoutId.unref()
  }
}

/**
 * Handle fatal error - stop the task and emit fatal error event.
 */
const handleFatalError = (
  task: Task,
  error: unknown,
  reason: string,
  emitters: Emitters,
  stopTask: (name: string) => void,
): void => {
  const errorMessage = getErrorMessage(error)
  const errorObj = getErrorObject(error)

  logger.error({ taskName: task.name, error: errorMessage }, reason)

  stopTask(task.name)

  emitters.emitFatalError({
    name: task.name,
    error: errorObj,
    timestamp: new Date(),
  })
}

/**
 * Log task execution error.
 */
const logTaskError = (task: Task, error: unknown): Error => {
  const errorMessage = getErrorMessage(error)
  const errorObj = getErrorObject(error)

  logger.error(
    {
      taskName: task.name,
      error: errorMessage,
      errorType: errorObj.name,
      attempt: task.retryAttempt,
    },
    'Task execution failed',
  )

  return errorObj
}

/**
 * Handle task failure and determine retry behavior.
 */
const handleTaskFailure = (
  task: Task,
  error: unknown,
  timestamp: Date,
  schedulerOptions: Required<SchedulerOptions>,
  emitters: Emitters,
  stopTask: (name: string) => void,
): void => {
  task.errorCount++
  const errorObj = logTaskError(task, error)

  emitters.emitError({
    name: task.name,
    error: errorObj,
    attempt: task.retryAttempt,
    timestamp,
  })

  // Determine if we should retry
  const shouldRetry =
    error instanceof RetryableError || (!(error instanceof FatalError) && !(error instanceof SchedulerError))

  if (shouldRetry && task.retryAttempt < task.options.retries) {
    scheduleRetry(task, schedulerOptions, emitters, stopTask)
  } else if (error instanceof FatalError) {
    handleFatalError(task, error, 'Fatal error occurred, stopping task', emitters, stopTask)
  } else if (task.retryAttempt >= task.options.retries) {
    handleFatalError(task, error, 'Max retries exceeded, stopping task', emitters, stopTask)
  }
}

/**
 * Execute a single task with error handling and retries.
 */
export const executeTask = async (
  task: Task,
  schedulerOptions: Required<SchedulerOptions>,
  emitters: Emitters,
  stopTask: (name: string) => void,
): Promise<void> => {
  const startTime = Date.now()
  const timestamp = new Date(startTime)

  logger.debug({ taskName: task.name }, 'Executing task')

  try {
    await task.handler()
    handleTaskSuccess(task, startTime, emitters)
  } catch (error) {
    handleTaskFailure(task, error, timestamp, schedulerOptions, emitters, stopTask)
  }
}

/**
 * Schedule a task for periodic execution.
 */
export const scheduleTask = (
  task: Task,
  schedulerOptions: Required<SchedulerOptions>,
  emitters: Emitters,
  stopTask: (name: string) => void,
): void => {
  if (task.intervalId !== null) {
    return
  }

  task.nextRun = new Date(Date.now() + task.interval)

  task.intervalId = setInterval(() => {
    task.nextRun = new Date(Date.now() + task.interval)
    void executeTask(task, schedulerOptions, emitters, stopTask)
  }, task.interval)

  if (task.options.unref) {
    task.intervalId.unref()
  }

  logger.debug({ taskName: task.name, interval: task.interval }, 'Task scheduled')
}
