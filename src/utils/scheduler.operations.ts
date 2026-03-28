/**
 * Scheduler operations - register, start, stop, unregister tasks.
 */

import { logger } from '../logger.js'
import { TaskAlreadyExistsError, TaskNotFoundError } from './scheduler.errors.js'
import { type Emitters, type EventEmitter, type Task, mergeTaskOptions } from './scheduler.helpers.js'
import { executeTask, scheduleTask } from './scheduler.internal.js'
import type { SchedulerOptions, TaskConfig, TaskState } from './scheduler.types.js'

/**
 * Operation context shared between scheduler operations.
 */
export interface SchedulerContext {
  readonly tasks: Map<string, Task>
  readonly events: EventEmitter
  readonly emitters: Emitters
  readonly schedulerOptions: Required<SchedulerOptions>
}

/**
 * Register a new task.
 */
export const registerTask = (
  context: SchedulerContext,
  name: string,
  config: Omit<TaskConfig, 'name'>,
  startFn: (name: string) => void,
): void => {
  const { tasks, schedulerOptions } = context

  if (tasks.has(name)) {
    throw new TaskAlreadyExistsError(name)
  }

  const mergedOptions = mergeTaskOptions(config.options, schedulerOptions)

  const task: Task = {
    name,
    handler: config.handler,
    interval: config.interval ?? 60000,
    options: mergedOptions,
    running: false,
    intervalId: null,
    lastRun: null,
    nextRun: null,
    errorCount: 0,
    retryAttempt: 0,
    retryTimeoutId: null,
  }

  tasks.set(name, task)

  logger.info({ taskName: name, interval: task.interval, options: mergedOptions }, 'Task registered')

  if (mergedOptions.immediate) {
    startFn(name)
  }
}

/**
 * Start a registered task.
 */
export const startTask = (context: SchedulerContext, name: string, stopFn: (name: string) => void): void => {
  const { tasks, emitters, schedulerOptions } = context
  const task = tasks.get(name)

  if (task === undefined) {
    throw new TaskNotFoundError(name)
  }

  if (task.running) {
    logger.debug({ taskName: name }, 'Task already running, skipping start')
    return
  }

  task.running = true
  scheduleTask(task, schedulerOptions, emitters, stopFn)

  // Execute immediately if configured
  if (task.options.immediate) {
    queueMicrotask(() => {
      void executeTask(task, schedulerOptions, emitters, stopFn)
    })
  }

  logger.info({ taskName: name }, 'Task started')
}

/**
 * Stop a running task.
 */
export const stopTask = (context: SchedulerContext, name: string): void => {
  const { tasks } = context
  const task = tasks.get(name)

  if (task === undefined) {
    throw new TaskNotFoundError(name)
  }

  if (!task.running) {
    logger.debug({ taskName: name }, 'Task already stopped, skipping stop')
    return
  }

  task.running = false

  if (task.intervalId !== null) {
    clearInterval(task.intervalId)
    task.intervalId = null
  }

  if (task.retryTimeoutId !== null) {
    clearTimeout(task.retryTimeoutId)
    task.retryTimeoutId = null
  }

  task.nextRun = null

  logger.info({ taskName: name }, 'Task stopped')
}

/**
 * Unregister a task (removes it from the scheduler).
 */
export const unregisterTask = (context: SchedulerContext, name: string, stopFn: (name: string) => void): void => {
  const { tasks } = context
  const task = tasks.get(name)

  if (task === undefined) {
    throw new TaskNotFoundError(name)
  }

  // Stop the task first if it's running
  if (task.running) {
    stopFn(name)
  }

  tasks.delete(name)

  logger.info({ taskName: name }, 'Task unregistered')
}

/**
 * Start all registered tasks.
 */
export const startAllTasks = (context: SchedulerContext, startFn: (name: string) => void): void => {
  const { tasks } = context

  logger.info({ taskCount: tasks.size }, 'Starting all tasks')
  tasks.forEach((_, name) => {
    try {
      startFn(name)
    } catch (error) {
      const msg = error instanceof Error ? error.message : 'Unknown error'
      logger.error({ taskName: name, error: msg }, 'Failed to start task')
    }
  })
}

/**
 * Stop all registered tasks.
 */
export const stopAllTasks = (context: SchedulerContext, stopFn: (name: string) => void): void => {
  const { tasks } = context

  logger.info({ taskCount: tasks.size }, 'Stopping all tasks')
  tasks.forEach((_, name) => {
    try {
      stopFn(name)
    } catch (error) {
      const msg = error instanceof Error ? error.message : 'Unknown error'
      logger.error({ taskName: name, error: msg }, 'Failed to stop task')
    }
  })
}

/**
 * Check if a task exists.
 */
export const taskExists = (context: SchedulerContext, name: string): boolean => context.tasks.has(name)

/**
 * Get task state.
 */
export const getTaskState = (context: SchedulerContext, name: string): TaskState | null => {
  const task = context.tasks.get(name)
  if (task === undefined) {
    return null
  }

  return {
    running: task.running,
    lastRun: task.lastRun,
    nextRun: task.nextRun,
    errorCount: task.errorCount,
    retryAttempt: task.retryAttempt,
  }
}
