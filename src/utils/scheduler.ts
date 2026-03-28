/**
 * Core scheduler implementation for papai.
 *
 * Provides robust task scheduling with error handling, retries, and graceful shutdown.
 * Replaces raw `setInterval` usage with a centralized, testable utility.
 */

import { createEmitters } from './scheduler.events.js'
import { type EventEmitter, mergeOptions, type Task } from './scheduler.helpers.js'
import {
  type SchedulerContext,
  getTaskState,
  registerTask,
  startAllTasks,
  startTask,
  stopAllTasks,
  stopTask,
  taskExists,
  unregisterTask,
} from './scheduler.operations.js'
import type {
  ErrorHandler,
  FatalErrorHandler,
  RetryHandler,
  SchedulerOptions,
  TaskConfig,
  TaskState,
  TickHandler,
} from './scheduler.types.js'

/**
 * Scheduler interface returned by createScheduler.
 */
export interface Scheduler {
  register: (name: string, config: Omit<TaskConfig, 'name'>) => void
  start: (name: string) => void
  stop: (name: string) => void
  unregister: (name: string) => void
  startAll: () => void
  stopAll: () => void
  hasTask: (name: string) => boolean
  getTaskState: (name: string) => TaskState | null
  on: (
    event: 'tick' | 'error' | 'retry' | 'fatalError',
    handler: TickHandler | ErrorHandler | RetryHandler | FatalErrorHandler,
  ) => void
}

/**
 * Create bound functions for scheduler operations.
 */
const createBoundFunctions = (
  context: SchedulerContext,
): {
  start: (name: string) => void
  stop: (name: string) => void
} => {
  // Create bound functions for circular dependencies
  const boundStop = (name: string): void => {
    stopTask(context, name)
  }
  const boundStart = (name: string): void => {
    startTask(context, name, boundStop)
  }

  return { start: boundStart, stop: boundStop }
}

/**
 * Create a new scheduler instance.
 *
 * @param options - Optional scheduler configuration
 * @returns Scheduler interface
 */
export const createScheduler = (options?: SchedulerOptions): Scheduler => {
  const schedulerOptions = mergeOptions(options)
  const tasks = new Map<string, Task>()
  const events: EventEmitter = {
    tick: new Set(),
    error: new Set(),
    retry: new Set(),
    fatalError: new Set(),
  }

  const emitters = createEmitters(events)
  const context: SchedulerContext = {
    tasks,
    events,
    emitters,
    schedulerOptions,
  }

  const boundFunctions = createBoundFunctions(context)
  const { start, stop } = boundFunctions

  const register = (name: string, config: Omit<TaskConfig, 'name'>): void => {
    registerTask(context, name, config, start)
  }

  const unregister = (name: string): void => {
    unregisterTask(context, name, stop)
  }

  const startAll = (): void => {
    startAllTasks(context, start)
  }

  const stopAll = (): void => {
    stopAllTasks(context, stop)
  }

  const hasTask = (name: string): boolean => taskExists(context, name)

  const getState = (name: string): TaskState | null => getTaskState(context, name)

  const on = (
    event: 'tick' | 'error' | 'retry' | 'fatalError',
    handler: TickHandler | ErrorHandler | RetryHandler | FatalErrorHandler,
  ): void => {
    if (event === 'tick') {
      events.tick.add(handler as unknown as TickHandler)
    } else if (event === 'error') {
      events.error.add(handler as unknown as ErrorHandler)
    } else if (event === 'retry') {
      events.retry.add(handler as unknown as RetryHandler)
    } else if (event === 'fatalError') {
      events.fatalError.add(handler as unknown as FatalErrorHandler)
    }
  }

  return {
    register,
    start,
    stop,
    unregister,
    startAll,
    stopAll,
    hasTask,
    getTaskState: getState,
    on,
  }
}

// Re-export types and errors for convenience
export {
  FatalError,
  RetryableError,
  SchedulerError,
  TaskAlreadyExistsError,
  TaskNotFoundError,
} from './scheduler.errors.js'
export type {
  ErrorEvent,
  ErrorHandler,
  FatalErrorEvent,
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
