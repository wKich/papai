/**
 * Error classes for the centralized Scheduler utility.
 *
 * Provides specific error types for different scheduler failure scenarios,
 * enabling proper error handling and recovery strategies.
 */

/**
 * Base error class for all scheduler-related errors.
 *
 * Use this as the base class for all scheduler errors to allow catching
 * scheduler-specific errors separately from other application errors.
 *
 * @example
 * ```typescript
 * try {
 *   await scheduler.start('my-task')
 * } catch (error) {
 *   if (error instanceof SchedulerError) {
 *     // Handle scheduler-specific error
 *   }
 * }
 * ```
 */
export class SchedulerError extends Error {
  constructor(message: string, options?: { cause?: Error }) {
    super(message, options)
    this.name = 'SchedulerError'
  }
}

/**
 * Error indicating a task failure that can be retried with backoff.
 *
 * Throw this error when a task fails due to transient issues (network timeouts,
 * temporary unavailability, rate limiting) where retrying may succeed.
 * The scheduler will automatically retry the task with exponential backoff.
 *
 * @example
 * ```typescript
 * async function fetchData() {
 *   try {
 *     return await api.fetch()
 *   } catch (error) {
 *     if (isNetworkError(error)) {
 *       throw new RetryableError('API temporarily unavailable', { cause: error })
 *     }
 *     throw error
 *   }
 * }
 * ```
 */
export class RetryableError extends SchedulerError {
  constructor(message: string, options?: { cause?: Error }) {
    super(message, options)
    this.name = 'RetryableError'
  }
}

/**
 * Error indicating a task failure that should stop retrying immediately.
 *
 * Throw this error when a task fails due to non-recoverable issues
 * (invalid configuration, logic errors, permanent failures) where retrying
 * would not help. The scheduler will stop retrying and emit a fatal error event.
 *
 * @example
 * ```typescript
 * async function processData(config: Config) {
 *   if (!config.apiKey) {
 *     throw new FatalError('API key is required but not configured')
 *   }
 *   // ... process data
 * }
 * ```
 */
export class FatalError extends SchedulerError {
  constructor(message: string, options?: { cause?: Error }) {
    super(message, options)
    this.name = 'FatalError'
  }
}

/**
 * Error thrown when attempting to access a task that does not exist.
 *
 * This error is thrown when:
 * - Starting, stopping, or removing a non-existent task
 * - Getting status of an unregistered task
 * - Updating a task that was never registered
 *
 * @example
 * ```typescript
 * try {
 *   await scheduler.stop('unknown-task')
 * } catch (error) {
 *   if (error instanceof TaskNotFoundError) {
 *     console.log(`Task "${error.taskName}" not found`)
 *   }
 * }
 * ```
 */
export class TaskNotFoundError extends SchedulerError {
  readonly taskName: string

  constructor(taskName: string) {
    super(`Task "${taskName}" not found`)
    this.name = 'TaskNotFoundError'
    this.taskName = taskName
  }
}

/**
 * Error thrown when attempting to register a task that already exists.
 *
 * This error is thrown when:
 * - Registering a task with a name that's already in use
 * - Duplicate task registration attempts
 *
 * To update an existing task, remove it first then re-register.
 *
 * @example
 * ```typescript
 * try {
 *   scheduler.register({ name: 'cleanup', handler: cleanupFn, interval: 60000 })
 * } catch (error) {
 *   if (error instanceof TaskAlreadyExistsError) {
 *     console.log(`Task "${error.taskName}" is already registered`)
 *     // Remove and re-register if needed
 *     scheduler.remove(error.taskName)
 *     scheduler.register({ name: 'cleanup', handler: cleanupFn, interval: 60000 })
 *   }
 * }
 * ```
 */
export class TaskAlreadyExistsError extends SchedulerError {
  readonly taskName: string

  constructor(taskName: string) {
    super(`Task "${taskName}" is already registered`)
    this.name = 'TaskAlreadyExistsError'
    this.taskName = taskName
  }
}
