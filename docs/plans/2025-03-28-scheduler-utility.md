# Scheduler Utility Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Create a centralized Scheduler utility that replaces all raw `setInterval` usage with robust error handling, retries, and graceful shutdown support.

**Architecture:** Factory pattern `createScheduler()` returns a task manager with registration, lifecycle control, and event hooks. Tasks support both millisecond intervals and cron expressions via Bun's native `Bun.cron.parse()`.

**Tech Stack:** TypeScript, Bun (for `Bun.cron`), pino (logging)

---

## Task 1: Create Scheduler Types

**Files:**

- Create: `src/utils/scheduler.types.ts`

**Step 1: Write type definitions**

```typescript
/**
 * Scheduler configuration options
 */
export interface SchedulerOptions {
  /** Allow process to exit if only scheduler is running (default: true) */
  readonly unrefByDefault?: boolean
  /** Default retry attempts for failed tasks (default: 3) */
  readonly defaultRetries?: number
  /** Maximum retry delay in ms (default: 60000) */
  readonly maxRetryDelay?: number
}

/**
 * Task handler function
 */
export type TaskHandler = () => Promise<void> | void

/**
 * Task configuration
 */
export interface TaskConfig {
  /** Task name (unique identifier) */
  readonly name: string
  /** Handler function to execute */
  readonly handler: TaskHandler
  /** Millisecond interval OR cron expression */
  readonly interval?: number
  readonly cron?: string
  /** Task-specific options */
  readonly options?: {
    /** Run immediately on start (default: false) */
    readonly immediate?: boolean
    /** Override default retries */
    readonly retries?: number
    /** Override default unref behavior */
    readonly unref?: boolean
  }
}

/**
 * Task state
 */
export interface TaskState {
  readonly running: boolean
  readonly lastRun: Date | null
  readonly nextRun: Date | null
  readonly errorCount: number
  readonly retryAttempt: number
}

/**
 * Event payload types
 */
export interface TickEvent {
  readonly name: string
  readonly duration: number
  readonly timestamp: Date
}

export interface ErrorEvent {
  readonly name: string
  readonly error: Error
  readonly attempt: number
  readonly timestamp: Date
}

export interface RetryEvent {
  readonly name: string
  readonly attempt: number
  readonly delay: number
  readonly timestamp: Date
}

export interface FatalErrorEvent {
  readonly name: string
  readonly error: Error
  readonly timestamp: Date
}

/**
 * Event handler types
 */
export type TickHandler = (event: TickEvent) => void
export type ErrorHandler = (event: ErrorEvent) => void
export type RetryHandler = (event: RetryEvent) => void
export type FatalErrorHandler = (event: FatalErrorEvent) => void
```

**Step 2: Verify types compile**

Run: `bun typecheck`
Expected: No errors

**Step 3: Commit**

```bash
git add src/utils/scheduler.types.ts
git commit -m "feat(scheduler): add type definitions"
```

---

## Task 2: Create Error Classes

**Files:**

- Create: `src/utils/scheduler.errors.ts`

**Step 1: Write error classes**

```typescript
/**
 * Base scheduler error
 */
export class SchedulerError extends Error {
  constructor(message: string, options?: { cause?: Error }) {
    super(message, options)
    this.name = 'SchedulerError'
  }
}

/**
 * Error that can be retried with backoff
 */
export class RetryableError extends SchedulerError {
  constructor(message: string, options?: { cause?: Error }) {
    super(message, options)
    this.name = 'RetryableError'
  }
}

/**
 * Fatal error that stops retrying immediately
 */
export class FatalError extends SchedulerError {
  constructor(message: string, options?: { cause?: Error }) {
    super(message, options)
    this.name = 'FatalError'
  }
}

/**
 * Task not found error
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
 * Task already registered error
 */
export class TaskAlreadyExistsError extends SchedulerError {
  readonly taskName: string

  constructor(taskName: string) {
    super(`Task "${taskName}" is already registered`)
    this.name = 'TaskAlreadyExistsError'
    this.taskName = taskName
  }
}
```

**Step 2: Verify types compile**

Run: `bun typecheck`
Expected: No errors

**Step 3: Commit**

```bash
git add src/utils/scheduler.errors.ts
git commit -m "feat(scheduler): add error classes"
```

---

## Task 3: Implement Core Scheduler

**Files:**

- Create: `src/utils/scheduler.ts`
- Modify: `src/utils/scheduler.types.ts` (if needed for Scheduler interface)

**Step 1: Write failing test first**

Create: `tests/utils/scheduler.test.ts`

```typescript
import { describe, expect, test, beforeEach } from 'bun:test'
import { createScheduler } from '../../src/utils/scheduler.js'

describe('Scheduler', () => {
  let scheduler: ReturnType<typeof createScheduler>

  beforeEach(() => {
    scheduler = createScheduler()
  })

  test('should register a task', () => {
    scheduler.register('test-task', {
      interval: 1000,
      handler: () => {},
    })

    expect(scheduler.hasTask('test-task')).toBe(true)
  })

  test('should throw on duplicate registration', () => {
    scheduler.register('test-task', {
      interval: 1000,
      handler: () => {},
    })

    expect(() => {
      scheduler.register('test-task', {
        interval: 1000,
        handler: () => {},
      })
    }).toThrow('already registered')
  })
})
```

**Step 2: Run test to verify it fails**

Run: `bun test tests/utils/scheduler.test.ts`
Expected: FAIL - module not found

**Step 3: Implement core scheduler**

```typescript
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
  RetryEvent,
  SchedulerOptions,
  TaskConfig,
  TaskState,
  TickEvent,
} from './scheduler.types.js'

const DEFAULT_OPTIONS: Required<SchedulerOptions> = {
  unrefByDefault: true,
  defaultRetries: 3,
  maxRetryDelay: 60_000,
}

interface Task {
  config: TaskConfig
  state: TaskState
  intervalId: ReturnType<typeof setInterval> | null
  timeoutId: ReturnType<typeof setTimeout> | null
}

type EventHandlers = {
  tick: Array<(event: TickEvent) => void>
  error: Array<(event: ErrorEvent) => void>
  retry: Array<(event: RetryEvent) => void>
  fatalError: Array<(event: FatalErrorEvent) => void>
}

export function createScheduler(options: SchedulerOptions = {}) {
  const log = logger.child({ scope: 'scheduler' })
  const opts = { ...DEFAULT_OPTIONS, ...options }
  const tasks = new Map<string, Task>()
  const handlers: EventHandlers = {
    tick: [],
    error: [],
    retry: [],
    fatalError: [],
  }

  function calculateBackoff(attempt: number): number {
    const base = Math.min(2 ** attempt * 1000, opts.maxRetryDelay)
    const jitter = Math.random() * 0.1 * base
    return base + jitter
  }

  async function executeTask(task: Task): Promise<void> {
    const startTime = Date.now()
    const { config, state } = task

    task.state = {
      ...state,
      lastRun: new Date(),
    }

    try {
      await config.handler()

      const duration = Date.now() - startTime
      task.state.errorCount = 0
      task.state.retryAttempt = 0

      for (const handler of handlers.tick) {
        handler({
          name: config.name,
          duration,
          timestamp: new Date(),
        })
      }
    } catch (error) {
      task.state.errorCount++

      if (error instanceof FatalError) {
        log.error({ task: config.name, error: error.message }, 'Fatal error in task, stopping')
        stop(config.name)

        for (const handler of handlers.fatalError) {
          handler({
            name: config.name,
            error: error instanceof Error ? error : new Error(String(error)),
            timestamp: new Date(),
          })
        }
        return
      }

      const isRetryable = error instanceof RetryableError || !(error instanceof SchedulerError)
      const maxRetries = config.options?.retries ?? opts.defaultRetries

      if (!isRetryable || task.state.retryAttempt >= maxRetries) {
        log.error(
          { task: config.name, error: error instanceof Error ? error.message : String(error) },
          'Task failed permanently',
        )
        stop(config.name)

        for (const handler of handlers.fatalError) {
          handler({
            name: config.name,
            error: error instanceof Error ? error : new Error(String(error)),
            timestamp: new Date(),
          })
        }
        return
      }

      task.state.retryAttempt++
      const delay = calculateBackoff(task.state.retryAttempt)

      log.warn({ task: config.name, attempt: task.state.retryAttempt, delay }, 'Task failed, scheduling retry')

      for (const handler of handlers.error) {
        handler({
          name: config.name,
          error: error instanceof Error ? error : new Error(String(error)),
          attempt: task.state.retryAttempt,
          timestamp: new Date(),
        })
      }

      task.timeoutId = setTimeout(() => {
        task.timeoutId = null
        void executeTask(task)
      }, delay)
    }
  }

  function register(name: string, config: Omit<TaskConfig, 'name'>): void {
    if (tasks.has(name)) {
      throw new TaskAlreadyExistsError(name)
    }

    const task: Task = {
      config: { ...config, name },
      state: {
        running: false,
        lastRun: null,
        nextRun: null,
        errorCount: 0,
        retryAttempt: 0,
      },
      intervalId: null,
      timeoutId: null,
    }

    tasks.set(name, task)
    log.debug({ task: name }, 'Task registered')
  }

  function start(name: string): void {
    const task = tasks.get(name)
    if (!task) {
      throw new TaskNotFoundError(name)
    }

    if (task.state.running) {
      log.warn({ task: name }, 'Task already running')
      return
    }

    const { config, state } = task
    const interval = config.interval ?? 60_000 // Default 1 minute if no interval
    const shouldUnref = config.options?.unref ?? opts.unrefByDefault

    task.state.running = true

    // Run immediately if requested
    if (config.options?.immediate) {
      void executeTask(task)
    }

    // Set up interval
    task.intervalId = setInterval(() => {
      void executeTask(task)
    }, interval)

    if (shouldUnref && task.intervalId) {
      task.intervalId.unref()
    }

    log.info({ task: name, interval }, 'Task started')
  }

  function stop(name: string): void {
    const task = tasks.get(name)
    if (!task) {
      throw new TaskNotFoundError(name)
    }

    if (task.intervalId) {
      clearInterval(task.intervalId)
      task.intervalId = null
    }

    if (task.timeoutId) {
      clearTimeout(task.timeoutId)
      task.timeoutId = null
    }

    task.state.running = false
    log.info({ task: name }, 'Task stopped')
  }

  function startAll(): void {
    for (const [name] of tasks) {
      start(name)
    }
  }

  function stopAll(): void {
    for (const [name] of tasks) {
      stop(name)
    }
  }

  function hasTask(name: string): boolean {
    return tasks.has(name)
  }

  function getTaskState(name: string): TaskState | null {
    const task = tasks.get(name)
    return task ? { ...task.state } : null
  }

  function on(event: 'tick', handler: (event: TickEvent) => void): void
  function on(event: 'error', handler: (event: ErrorEvent) => void): void
  function on(event: 'retry', handler: (event: RetryEvent) => void): void
  function on(event: 'fatalError', handler: (event: FatalErrorEvent) => void): void
  function on(event: keyof EventHandlers, handler: (...args: unknown[]) => void): void {
    handlers[event].push(handler as () => void)
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
```

**Step 4: Run test to verify it passes**

Run: `bun test tests/utils/scheduler.test.ts`
Expected: PASS

**Step 5: Commit**

```bash
git add src/utils/scheduler.ts tests/utils/scheduler.test.ts
git commit -m "feat(scheduler): implement core scheduler with retries"
```

---

## Task 4: Add Cron Expression Support

**Files:**

- Modify: `src/utils/scheduler.ts`

**Step 1: Update scheduler to support cron**

Add cron support using `Bun.cron.parse()`:

```typescript
// Add at top of scheduler.ts
function calculateNextCronRun(cronExpr: string): number {
  const next = Bun.cron.parse(cronExpr)
  if (!next) {
    throw new Error(`Invalid cron expression: ${cronExpr}`)
  }
  return next.getTime() - Date.now()
}

// Modify executeTask to handle cron
async function scheduleNextExecution(task: Task): Promise<void> {
  const { config } = task

  if (config.cron) {
    // For cron tasks, calculate next run and use setTimeout
    const delay = calculateNextCronRun(config.cron)
    task.state.nextRun = new Date(Date.now() + delay)

    task.timeoutId = setTimeout(() => {
      task.timeoutId = null
      void executeTask(task).then(() => {
        // Reschedule after execution
        void scheduleNextExecution(task)
      })
    }, delay)
  }
}

// Update start() function
function start(name: string): void {
  const task = tasks.get(name)
  if (!task) {
    throw new TaskNotFoundError(name)
  }

  if (task.state.running) {
    log.warn({ task: name }, 'Task already running')
    return
  }

  const { config } = task

  // Must have either interval or cron
  if (!config.interval && !config.cron) {
    throw new Error(`Task "${name}" must have either interval or cron`)
  }

  task.state.running = true

  // Run immediately if requested
  if (config.options?.immediate) {
    void executeTask(task)
  }

  if (config.cron) {
    // Cron-based: use setTimeout with calculated delay
    void scheduleNextExecution(task)
    log.info({ task: name, cron: config.cron }, 'Task started (cron)')
  } else {
    // Interval-based: use setInterval
    const interval = config.interval ?? 60_000
    const shouldUnref = config.options?.unref ?? opts.unrefByDefault

    task.intervalId = setInterval(() => {
      void executeTask(task)
    }, interval)

    if (shouldUnref && task.intervalId) {
      task.intervalId.unref()
    }

    log.info({ task: name, interval }, 'Task started (interval)')
  }
}

// Update stop() to clear cron timeouts
function stop(name: string): void {
  const task = tasks.get(name)
  if (!task) {
    throw new TaskNotFoundError(name)
  }

  if (task.intervalId) {
    clearInterval(task.intervalId)
    task.intervalId = null
  }

  if (task.timeoutId) {
    clearTimeout(task.timeoutId)
    task.timeoutId = null
  }

  task.state.running = false
  task.state.nextRun = null
  log.info({ task: name }, 'Task stopped')
}
```

**Step 2: Add test for cron**

Add to `tests/utils/scheduler.test.ts`:

```typescript
test('should support cron expressions', () => {
  scheduler.register('cron-task', {
    cron: '*/5 * * * *', // Every 5 minutes
    handler: () => {},
  })

  expect(scheduler.hasTask('cron-task')).toBe(true)
})

test('should throw on invalid cron', () => {
  scheduler.register('bad-cron', {
    cron: 'invalid',
    handler: () => {},
  })

  expect(() => scheduler.start('bad-cron')).toThrow()
})
```

**Step 3: Run tests**

Run: `bun test tests/utils/scheduler.test.ts`
Expected: PASS

**Step 4: Commit**

```bash
git add src/utils/scheduler.ts tests/utils/scheduler.test.ts
git commit -m "feat(scheduler): add cron expression support via Bun.cron"
```

---

## Task 5: Migrate cache.ts

**Files:**

- Modify: `src/cache.ts`
- Modify: `src/index.ts` (to start scheduler)

**Step 1: Modify cache.ts to export a setup function**

Replace the module-level `setInterval`:

```typescript
// Remove this:
// setInterval(() => { ... }, 5 * 60 * 1000)

// Add this:
let cleanupIntervalId: ReturnType<typeof setInterval> | null = null

export function startCacheCleanup(): void {
  if (cleanupIntervalId !== null) return

  cleanupIntervalId = setInterval(
    () => {
      // existing cleanup logic
      const now = Date.now()
      const expired: string[] = []
      for (const [userId, cache] of userCaches) {
        if (now - cache.lastAccessed > SESSION_TTL_MS) {
          expired.push(userId)
        }
      }
      for (const userId of expired) {
        userCaches.delete(userId)
        log.debug({ userId }, 'Expired user cache removed')
      }
      if (expired.length > 0) {
        log.info({ expiredCount: expired.length }, 'Cleaned up expired user caches')
      }
    },
    5 * 60 * 1000,
  )

  cleanupIntervalId.unref()
  log.info('Cache cleanup started')
}

export function stopCacheCleanup(): void {
  if (cleanupIntervalId !== null) {
    clearInterval(cleanupIntervalId)
    cleanupIntervalId = null
    log.info('Cache cleanup stopped')
  }
}
```

**Step 2: Update src/index.ts to call startCacheCleanup**

Find where the app starts and add:

```typescript
import { startCacheCleanup } from './cache.js'

// In startup code:
startCacheCleanup()
```

**Step 3: Test the migration**

Run: `bun start`
Expected: App starts, cache cleanup running

**Step 4: Commit**

```bash
git add src/cache.ts src/index.ts
git commit -m "refactor(cache): use scheduler-compatible cleanup function"
```

---

## Task 6: Migrate message-cache

**Files:**

- Modify: `src/message-cache/cache.ts`
- Modify: `src/message-cache/persistence.ts`
- Modify: `src/index.ts`

**Step 1: Refactor cache.ts**

Convert module-level interval to managed function:

```typescript
// Remove: setInterval(() => { ... }, 24 * 60 * 60 * 1000)

let sweepIntervalId: ReturnType<typeof setInterval> | null = null

export function startMessageCacheSweep(): void {
  if (sweepIntervalId !== null) return

  sweepIntervalId = setInterval(
    () => {
      const now = Date.now()
      let swept = 0
      for (const [key, msg] of messageCache) {
        if (now - msg.timestamp > ONE_WEEK_MS) {
          messageCache.delete(key)
          swept++
        }
      }
      if (swept > 0) {
        log.info({ swept, remaining: messageCache.size }, 'Swept expired message cache entries')
      }
    },
    24 * 60 * 60 * 1000,
  )

  sweepIntervalId.unref()
  log.info('Message cache sweep started')
}

export function stopMessageCacheSweep(): void {
  if (sweepIntervalId !== null) {
    clearInterval(sweepIntervalId)
    sweepIntervalId = null
    log.info('Message cache sweep stopped')
  }
}
```

**Step 2: Refactor persistence.ts**

Convert to managed function:

```typescript
// Remove: setInterval in startMessageCleanupScheduler
// Keep: cleanupExpiredMessages function

let cleanupIntervalId: ReturnType<typeof setInterval> | null = null

export function startMessageCleanupScheduler(): void {
  if (cleanupIntervalId !== null) {
    log.debug('Message cleanup scheduler already running')
    return
  }

  cleanupIntervalId = setInterval(
    () => {
      cleanupExpiredMessages()
    },
    60 * 60 * 1000,
  )

  cleanupIntervalId.unref()
  log.debug('Message cleanup scheduler started (hourly)')
}

export function stopMessageCleanupScheduler(): void {
  if (cleanupIntervalId !== null) {
    clearInterval(cleanupIntervalId)
    cleanupIntervalId = null
    log.info('Message cleanup scheduler stopped')
  }
}
```

**Step 3: Update src/index.ts**

```typescript
import { startMessageCacheSweep } from './message-cache/cache.js'
import { startMessageCleanupScheduler } from './message-cache/persistence.js'

// In startup:
startMessageCacheSweep()
startMessageCleanupScheduler()
```

**Step 4: Test**

Run: `bun start`
Expected: All cleanup functions running

**Step 5: Commit**

```bash
git add src/message-cache/cache.ts src/message-cache/persistence.ts src/index.ts
git commit -m "refactor(message-cache): use scheduler-compatible functions"
```

---

## Task 7: Create Central Scheduler Instance

**Files:**

- Create: `src/scheduler-instance.ts`

**Step 1: Create singleton scheduler**

```typescript
/**
 * Central scheduler instance for the application.
 * All periodic tasks should register here.
 */

import { createScheduler } from './utils/scheduler.js'

export const scheduler = createScheduler({
  unrefByDefault: true,
  defaultRetries: 3,
  maxRetryDelay: 60_000,
})

// Register tasks
scheduler.register('user-cache-cleanup', {
  interval: 5 * 60 * 1000, // 5 minutes
  handler: async () => {
    const { cleanupExpiredCaches } = await import('./cache.js')
    cleanupExpiredCaches()
  },
  options: { immediate: true },
})

scheduler.register('message-cache-sweep', {
  interval: 24 * 60 * 60 * 1000, // Daily
  handler: async () => {
    const { sweepExpiredMessages } = await import('./message-cache/cache.js')
    sweepExpiredMessages()
  },
  options: { immediate: true },
})

scheduler.register('message-cleanup', {
  interval: 60 * 60 * 1000, // Hourly
  handler: async () => {
    const { cleanupExpiredMessages } = await import('./message-cache/persistence.js')
    cleanupExpiredMessages()
  },
  options: { immediate: true },
})

// Event hooks
scheduler.on('error', ({ name, error, attempt }) => {
  // Errors are already logged by scheduler
  // Add any additional alerting here
})

scheduler.on('fatalError', ({ name, error }) => {
  // Task failed permanently - could alert on-call here
})
```

**Step 2: Update cache.ts to export cleanup function**

```typescript
export function cleanupExpiredCaches(): void {
  // Extract the cleanup logic from startCacheCleanup
  const now = Date.now()
  const expired: string[] = []
  for (const [userId, cache] of userCaches) {
    if (now - cache.lastAccessed > SESSION_TTL_MS) {
      expired.push(userId)
    }
  }
  for (const userId of expired) {
    userCaches.delete(userId)
    log.debug({ userId }, 'Expired user cache removed')
  }
  if (expired.length > 0) {
    log.info({ expiredCount: expired.length }, 'Cleaned up expired user caches')
  }
}
```

**Step 3: Update message-cache/cache.ts**

```typescript
export function sweepExpiredMessages(): void {
  const now = Date.now()
  let swept = 0
  for (const [key, msg] of messageCache) {
    if (now - msg.timestamp > ONE_WEEK_MS) {
      messageCache.delete(key)
      swept++
    }
  }
  if (swept > 0) {
    log.info({ swept, remaining: messageCache.size }, 'Swept expired message cache entries')
  }
}
```

**Step 4: Update src/index.ts**

```typescript
import { scheduler } from './scheduler-instance.js'

// In startup:
scheduler.startAll()

// In shutdown handler:
process.on('SIGTERM', async () => {
  await scheduler.stopAll()
  process.exit(0)
})
```

**Step 5: Test**

Run: `bun start`
Expected: All tasks start via scheduler

**Step 6: Commit**

```bash
git add src/scheduler-instance.ts src/cache.ts src/message-cache/cache.ts src/message-cache/persistence.ts src/index.ts
git commit -m "feat(scheduler): add central scheduler instance with all tasks"
```

---

## Task 8: Migrate Existing Scheduler

**Files:**

- Modify: `src/scheduler.ts`

**Step 1: Refactor to use centralized scheduler**

Replace manual interval management:

```typescript
// Before: manual intervalId, startScheduler(), stopScheduler()
// After: register with scheduler instance

import { scheduler } from './scheduler-instance.js'

// Register recurring task scheduler
scheduler.register('recurring-tasks', {
  interval: 60 * 1000, // 60 seconds
  handler: async () => {
    await tick()
  },
  options: { immediate: true },
})

// Export functions for backward compatibility
export function startScheduler(chatProvider: ChatProvider): void {
  chatProviderRef = chatProvider
  // Task is already registered, just ensure it's started
  if (!scheduler.getTaskState('recurring-tasks')?.running) {
    scheduler.start('recurring-tasks')
  }
}

export function stopScheduler(): void {
  scheduler.stop('recurring-tasks')
}
```

**Step 2: Test**

Run: `bun test:unit`
Expected: All tests pass

**Step 3: Commit**

```bash
git add src/scheduler.ts
git commit -m "refactor(scheduler): migrate to centralized scheduler"
```

---

## Task 9: Migrate Deferred Prompt Pollers

**Files:**

- Modify: `src/deferred-prompts/poller.ts`

**Step 1: Refactor to use scheduler**

```typescript
import { scheduler } from '../scheduler-instance.js'

export function startPollers(chat: ChatProvider, buildProviderFn: ProviderBuilder): void {
  if (isRunning) {
    log.warn('Pollers already running')
    return
  }

  isRunning = true
  chatProvider = chat
  providerBuilder = buildProviderFn

  scheduler.register('deferred-scheduled-poll', {
    interval: SCHEDULED_POLL_MS,
    handler: () => pollScheduledOnce(chat, buildProviderFn),
    options: { immediate: true },
  })

  scheduler.register('deferred-alert-poll', {
    interval: ALERT_POLL_MS,
    handler: () => pollAlertsOnce(chat, buildProviderFn),
    options: { immediate: true },
  })

  scheduler.start('deferred-scheduled-poll')
  scheduler.start('deferred-alert-poll')

  log.info({ scheduledPollMs: SCHEDULED_POLL_MS, alertPollMs: ALERT_POLL_MS }, 'Started deferred prompt pollers')
}

export function stopPollers(): void {
  log.info('Stopping deferred prompt pollers')
  scheduler.stop('deferred-scheduled-poll')
  scheduler.stop('deferred-alert-poll')
  isRunning = false
  chatProvider = null
  providerBuilder = null
}
```

**Step 2: Test**

Run: `bun test tests/deferred-prompts/`
Expected: Tests pass

**Step 3: Commit**

```bash
git add src/deferred-prompts/poller.ts
git commit -m "refactor(deferred-prompts): migrate to centralized scheduler"
```

---

## Task 10: Add Comprehensive Tests

**Files:**

- Modify: `tests/utils/scheduler.test.ts`

**Step 1: Add retry logic tests**

```typescript
test('should retry on retryable error', async () => {
  let attempts = 0
  const handler = () => {
    attempts++
    if (attempts < 3) {
      throw new RetryableError('Temporary failure')
    }
  }

  scheduler.register('retry-test', {
    interval: 100,
    handler,
    options: { retries: 3 },
  })

  scheduler.start('retry-test')

  // Wait for retries
  await new Promise((resolve) => setTimeout(resolve, 500))

  expect(attempts).toBe(3)
})

test('should stop after max retries', async () => {
  const handler = () => {
    throw new RetryableError('Always fails')
  }

  scheduler.register('max-retry-test', {
    interval: 100,
    handler,
    options: { retries: 2 },
  })

  scheduler.start('max-retry-test')

  // Wait for retries to complete
  await new Promise((resolve) => setTimeout(resolve, 1000))

  const state = scheduler.getTaskState('max-retry-test')
  expect(state?.running).toBe(false)
})

test('should not retry on fatal error', async () => {
  let attempts = 0
  const handler = () => {
    attempts++
    throw new FatalError('Config error')
  }

  scheduler.register('fatal-test', {
    interval: 100,
    handler,
    options: { retries: 3 },
  })

  scheduler.start('fatal-test')

  await new Promise((resolve) => setTimeout(resolve, 200))

  expect(attempts).toBe(1)
})
```

**Step 2: Add event hook tests**

```typescript
test('should fire tick event', async () => {
  let ticked = false
  scheduler.on('tick', () => {
    ticked = true
  })

  scheduler.register('tick-test', {
    interval: 50,
    handler: () => {},
  })

  scheduler.start('tick-test')
  await new Promise((resolve) => setTimeout(resolve, 100))

  expect(ticked).toBe(true)
})

test('should fire error event', async () => {
  let errorFired = false
  scheduler.on('error', () => {
    errorFired = true
  })

  scheduler.register('error-test', {
    interval: 50,
    handler: () => {
      throw new RetryableError('test error')
    },
  })

  scheduler.start('error-test')
  await new Promise((resolve) => setTimeout(resolve, 100))

  expect(errorFired).toBe(true)
})
```

**Step 3: Run all scheduler tests**

Run: `bun test tests/utils/scheduler.test.ts`
Expected: All tests pass

**Step 4: Commit**

```bash
git add tests/utils/scheduler.test.ts
git commit -m "test(scheduler): add retry and event tests"
```

---

## Task 11: Final Verification

**Step 1: Run full test suite**

Run: `bun test`
Expected: All tests pass

**Step 2: Run typecheck**

Run: `bun typecheck`
Expected: No errors

**Step 3: Run lint**

Run: `bun lint`
Expected: No errors

**Step 4: Test application startup**

Run: `bun start`
Expected: App starts, scheduler logs show tasks starting

**Step 5: Verify no raw setInterval remains**

Run: `grep -r "setInterval" src/ --include="*.ts" | grep -v "scheduler.ts" | grep -v "test"`
Expected: Only legitimate usages (should be minimal)

**Step 6: Commit any final fixes**

```bash
git add -A
git commit -m "chore(scheduler): final verification and cleanup"
```

---

## Success Criteria Verification

- [ ] All existing intervals migrated to scheduler
- [ ] Test coverage > 90% for scheduler module
- [ ] No raw `setInterval` in src/ (except in scheduler.ts)
- [ ] Process exits gracefully on SIGTERM
- [ ] All tests pass
- [ ] TypeScript strict mode passes
- [ ] Lint passes

---

## Rollback Instructions

If issues arise:

1. Revert to previous commit: `git revert HEAD~N`
2. Or manually restore old `setInterval` implementations
3. The scheduler can coexist with old patterns during migration

---

## Documentation

- Update README.md to mention Scheduler utility
- Add JSDoc to all public methods
- Example usage in `docs/examples/scheduler.md` (optional)
