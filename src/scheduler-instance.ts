/**
 * Central scheduler instance for the application.
 * All periodic tasks are registered here.
 */

import { cleanupExpiredCaches } from './cache.js'
import { sweepExpiredMessages } from './message-cache/cache.js'
import { cleanupExpiredMessages } from './message-cache/persistence.js'
import { createScheduler } from './utils/scheduler.js'
import type { ErrorEvent, FatalErrorEvent } from './utils/scheduler.types.js'

// Create singleton scheduler
export const scheduler = createScheduler({
  unrefByDefault: true,
  defaultRetries: 3,
  maxRetryDelay: 60_000,
})

// Register cleanup tasks
scheduler.register('user-cache-cleanup', {
  // 5 minutes
  interval: 5 * 60 * 1000,
  handler: cleanupExpiredCaches,
  options: { immediate: true },
})

scheduler.register('message-cache-sweep', {
  // Daily
  interval: 24 * 60 * 60 * 1000,
  handler: sweepExpiredMessages,
  options: { immediate: true },
})

scheduler.register('message-cleanup', {
  // Hourly
  interval: 60 * 60 * 1000,
  handler: cleanupExpiredMessages,
  options: { immediate: true },
})

// Event hooks
scheduler.on('error', ({ name, error, attempt }: ErrorEvent) => {
  // Errors are logged by scheduler, add any additional alerting here
  console.error(`Task ${name} failed (attempt ${attempt}):`, error)
})

scheduler.on('fatalError', ({ name, error }: FatalErrorEvent) => {
  // Task failed permanently - could alert on-call here
  console.error(`Task ${name} failed permanently:`, error)
})
