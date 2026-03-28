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
