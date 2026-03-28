/**
 * Core scheduler implementation for papai.
 *
 * Provides robust task scheduling with error handling, retries, and graceful shutdown.
 * Replaces raw `setInterval` usage with a centralized, testable utility.
 */

import { logger } from '../logger.js'
import {
  FatalError,
  RetryableError,
  SchedulerError,
  TaskAlreadyExistsError,
  TaskNotFoundError,
} from './scheduler.errors.js'
import type {
  ErrorEvent,
  FatalErrorEvent,
  ErrorHandler,
  FatalErrorHandler,
  RetryEvent,
  RetryHandler,
  SchedulerOptions,
  TaskConfig,
  TaskHandler,
  TaskOptions,
  TaskState,
  TickEvent,
  TickHandler,
} from './scheduler.types.js'

/**
 * Internal task record containing runtime state.
 */
interface Task {
  readonly name: string
  readonly handler: TaskHandler
  readonly interval: number
  readonly options: Required<TaskOptions>
  running: boolean
  intervalId: ReturnType<typeof setInterval> | null
  lastRun: Date | null
  nextRun: Date | null
  errorCount: number
  retryAttempt: number
  retryTimeoutId: ReturnType<typeof setTimeout> | null
}

/**
 * Default scheduler options.
 */
const DEFAULT_OPTIONS: Required<SchedulerOptions> = {
  unrefByDefault: true,
  defaultRetries: 3,
  maxRetryDelay: 60000,
}

/**
 * Default task options.
 */
const DEFAULT_TASK_OPTIONS: Required<TaskOptions> = {
  immediate: false,
  retries: 3,
  unref: true,
}

/**
 * Event emitter for scheduler events.
 */
interface EventEmitter {
  readonly tick: Set<TickHandler>
  readonly error: Set<ErrorHandler>
  readonly retry: Set<RetryHandler>
  readonly fatalError: Set<FatalErrorHandler>
}

/**
 * Calculate exponential backoff with jitter.
 *
 * Formula: min(2^attempt * 1000, maxDelay) + random(0, 10%)
 */
const calculateBackoff = (attempt: number, maxDelay: number): number => {
  const baseDelay = Math.min(2 ** attempt * 1000, maxDelay)
  const jitter = baseDelay * 0.1 * Math.random()
  return Math.floor(baseDelay + jitter)
}

/**
 * Merge options with defaults.
 */
const mergeOptions = (options: SchedulerOptions | undefined): Required<SchedulerOptions> => ({
  ...DEFAULT_OPTIONS,
  ...options,
})

/**
 * Merge task options with defaults.
 */
const mergeTaskOptions = (
  options: TaskOptions | undefined,
  schedulerDefaults: Required<SchedulerOptions>,
): Required<TaskOptions> => ({
  ...DEFAULT_TASK_OPTIONS,
  retries: schedulerDefaults.defaultRetries,
  unref: schedulerDefaults.unrefByDefault,
  ...options,
})

/**
 * Create a new scheduler instance.
 *
 * @param options - Optional scheduler configuration
 * @returns Scheduler interface with register, start, stop, and event methods
 */
export const createScheduler = (
  options?: SchedulerOptions,
): {
  register: (name: string, config: Omit<TaskConfig, 'name'>) => void
  start: (name: string) => void
  stop: (name: string) => void
  startAll: () => void
  stopAll: () => void
  hasTask: (name: string) => boolean
  getTaskState: (name: string) => TaskState | null
  on: (
    event: 'tick' | 'error' | 'retry' | 'fatalError',
    handler: TickHandler | ErrorHandler | RetryHandler | FatalErrorHandler,
  ) => void
} => {
  const schedulerOptions = mergeOptions(options)
  const tasks = new Map<string, Task>()
  const events: EventEmitter = {
    tick: new Set(),
    error: new Set(),
    retry: new Set(),
    fatalError: new Set(),
  }

  const emitTick = (event: TickEvent): void => {
    events.tick.forEach((handler) => {
      try {
        handler(event)
      } catch (error) {
        logger.error({ error: (error as Error).message, event: 'tick' }, 'Event handler threw error')
      }
    })
  }

  const emitError = (event: ErrorEvent): void => {
    events.error.forEach((handler) => {
      try {
        handler(event)
      } catch (error) {
        logger.error({ error: (error as Error).message, event: 'error' }, 'Event handler threw error')
      }
    })
  }

  const emitRetry = (event: RetryEvent): void => {
    events.retry.forEach((handler) => {
      try {
        handler(event)
      } catch (error) {
        logger.error({ error: (error as Error).message, event: 'retry' }, 'Event handler threw error')
      }
    })
  }

  const emitFatalError = (event: FatalErrorEvent): void => {
    events.fatalError.forEach((handler) => {
      try {
        handler(event)
      } catch (error) {
        logger.error({ error: (error as Error).message, event: 'fatalError' }, 'Event handler threw error')
      }
    })
  }

  const executeTask = async (task: Task): Promise<void> => {
    const startTime = Date.now()
    const timestamp = new Date(startTime)

    logger.debug({ taskName: task.name }, 'Executing task')

    try {
      await task.handler()

      const duration = Date.now() - startTime
      task.lastRun = timestamp
      task.retryAttempt = 0

      emitTick({
        name: task.name,
        duration,
        timestamp,
      })

      logger.info({ taskName: task.name, duration }, 'Task executed successfully')
    } catch (error) {
      task.errorCount++

      logger.error(
        {
          taskName: task.name,
          error: (error as Error).message,
          errorType: (error as Error).name,
          attempt: task.retryAttempt,
        },
        'Task execution failed',
      )

      emitError({
        name: task.name,
        error: error as Error,
        attempt: task.retryAttempt,
        timestamp,
      })

      // Determine if we should retry
      const shouldRetry =
        error instanceof RetryableError || (!(error instanceof FatalError) && !(error instanceof SchedulerError))

      if (shouldRetry && task.retryAttempt < task.options.retries) {
        task.retryAttempt++
        const delay = calculateBackoff(task.retryAttempt, schedulerOptions.maxRetryDelay)

        logger.warn(
          {
            taskName: task.name,
            attempt: task.retryAttempt,
            delay,
            maxRetries: task.options.retries,
          },
          'Scheduling retry with backoff',
        )

        emitRetry({
          name: task.name,
          attempt: task.retryAttempt,
          delay,
          timestamp: new Date(),
        })

        task.retryTimeoutId = setTimeout(() => {
          task.retryTimeoutId = null
          // Only execute if task is still running
          if (task.running) {
            void executeTask(task)
          }
        }, delay)

        if (task.options.unref && task.retryTimeoutId !== null) {
          task.retryTimeoutId.unref()
        }
      } else if (error instanceof FatalError) {
        logger.error({ taskName: task.name, error: (error as Error).message }, 'Fatal error occurred, stopping task')

        stop(task.name)

        emitFatalError({
          name: task.name,
          error: error as Error,
          timestamp: new Date(),
        })
      } else if (task.retryAttempt >= task.options.retries) {
        logger.error(
          {
            taskName: task.name,
            attempts: task.retryAttempt,
            maxRetries: task.options.retries,
          },
          'Max retries exceeded, stopping task',
        )

        stop(task.name)

        emitFatalError({
          name: task.name,
          error: error as Error,
          timestamp: new Date(),
        })
      }
    }
  }

  const scheduleTask = (task: Task): void => {
    if (task.intervalId !== null) {
      return
    }

    task.nextRun = new Date(Date.now() + task.interval)

    task.intervalId = setInterval(() => {
      task.nextRun = new Date(Date.now() + task.interval)
      void executeTask(task)
    }, task.interval)

    if (task.options.unref) {
      task.intervalId.unref()
    }

    logger.debug({ taskName: task.name, interval: task.interval }, 'Task scheduled')
  }

  const register = (name: string, config: Omit<TaskConfig, 'name'>): void => {
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
      start(name)
    }
  }

  const start = (name: string): void => {
    const task = tasks.get(name)
    if (task === undefined) {
      throw new TaskNotFoundError(name)
    }

    if (task.running) {
      logger.debug({ taskName: name }, 'Task already running, skipping start')
      return
    }

    task.running = true
    scheduleTask(task)

    // Execute immediately if configured
    if (task.options.immediate) {
      queueMicrotask(() => {
        void executeTask(task)
      })
    }

    logger.info({ taskName: name }, 'Task started')
  }

  const stop = (name: string): void => {
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

  const startAll = (): void => {
    logger.info({ taskCount: tasks.size }, 'Starting all tasks')
    tasks.forEach((_, name) => {
      try {
        start(name)
      } catch (error) {
        logger.error({ taskName: name, error: (error as Error).message }, 'Failed to start task')
      }
    })
  }

  const stopAll = (): void => {
    logger.info({ taskCount: tasks.size }, 'Stopping all tasks')
    tasks.forEach((_, name) => {
      try {
        stop(name)
      } catch (error) {
        logger.error({ taskName: name, error: (error as Error).message }, 'Failed to stop task')
      }
    })
  }

  const hasTask = (name: string): boolean => tasks.has(name)

  const getTaskState = (name: string): TaskState | null => {
    const task = tasks.get(name)
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

  const on = (
    event: 'tick' | 'error' | 'retry' | 'fatalError',
    handler: TickHandler | ErrorHandler | RetryHandler | FatalErrorHandler,
  ): void => {
    switch (event) {
      case 'tick':
        events.tick.add(handler as TickHandler)
        break
      case 'error':
        events.error.add(handler as ErrorHandler)
        break
      case 'retry':
        events.retry.add(handler as RetryHandler)
        break
      case 'fatalError':
        events.fatalError.add(handler as FatalErrorHandler)
        break
    }
  }

  return {
    register,
    start,
    stop,
    startAll,
    stopAll,
    hasTask,
    getTaskState,
    on,
  }
}
