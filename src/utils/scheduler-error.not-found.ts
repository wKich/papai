import { SchedulerError } from './scheduler-error.base.js'

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
