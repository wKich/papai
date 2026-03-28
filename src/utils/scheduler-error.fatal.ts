import { SchedulerError } from './scheduler-error.base.js'

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
