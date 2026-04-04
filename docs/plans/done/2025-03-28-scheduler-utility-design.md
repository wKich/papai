# Scheduler Utility Design

**Date:** 2025-03-28  
**Status:** Approved  
**Scope:** Replace all `setInterval` usage with a centralized, robust task scheduler

---

## Problem Statement

The codebase currently uses raw `setInterval` in multiple places with inconsistent patterns:

- **Module-level intervals** (`cache.ts`, `message-cache/cache.ts`): No cleanup mechanism, no error handling
- **Managed intervals** (`scheduler.ts`, `deferred-prompts/poller.ts`): Have start/stop but no error recovery
- **No graceful shutdown**: Intervals keep process alive, no `.unref()` usage
- **Silent failures**: Errors in callbacks don't prevent next tick but also aren't properly logged

## Goals

1. Centralize all periodic task management
2. Provide robust error handling with automatic retries
3. Enable graceful shutdown support
4. Support cron expressions via Bun's native `Bun.cron`
5. Maintain type safety and observability

---

## Architecture

### Core Components

```
┌─────────────────────────────────────────────────────────────┐
│                      Scheduler                               │
├─────────────────────────────────────────────────────────────┤
│  Task Registry                                               │
│  ├── name: string (unique identifier)                        │
│  ├── interval: number | cron: string                         │
│  ├── handler: () => Promise<void>                          │
│  ├── options: { immediate, retries, unref }                │
│  └── state: { running, lastRun, nextRun, errorCount }      │
├─────────────────────────────────────────────────────────────┤
│  Lifecycle Methods                                           │
│  ├── register(name, config): void                          │
│  ├── start(name): void                                     │
│  ├── stop(name): void                                        │
│  ├── startAll(): void                                        │
│  └── stopAll(): Promise<void>                               │
├─────────────────────────────────────────────────────────────┤
│  Event Hooks                                                 │
│  ├── on('tick', ({ name, duration }) => {})                │
│  ├── on('error', ({ name, error, attempt }) => {})         │
│  ├── on('retry', ({ name, attempt, delay }) => {})         │
│  └── on('fatalError', ({ name, error }) => {})             │
└─────────────────────────────────────────────────────────────┘
```

### Error Recovery Flow

```
┌─────────────┐
│   Handler   │── Error? ──Yes──┐
└─────────────┘                 │
                                ▼
┌─────────────┐         ┌──────────────┐
│   Success   │         │ Retryable?   │── No ──▶ Fatal Error
└─────────────┘         └──────────────┘
                              │ Yes
                              ▼
                    ┌──────────────────┐
                    │ Exponential      │
                    │ Backoff          │
                    │ (1s, 2s, 4s...)  │
                    └──────────────────┘
                              │
                              ▼
                    ┌──────────────────┐
                    │ Max Retries?     │── Yes ──▶ Fatal Error
                    └──────────────────┘
                              │ No
                              ▼
                         ┌─────────┐
                         │ Retry   │
                         └─────────┘
```

---

## API Reference

### Creating a Scheduler

```typescript
import { createScheduler } from './utils/scheduler.js'

const scheduler = createScheduler({
  unrefByDefault: true, // Allow graceful shutdown
  defaultRetries: 3, // Default retry attempts
  maxRetryDelay: 60_000, // Cap retry delay at 60s
})
```

### Registering Tasks

```typescript
// Simple interval
scheduler.register('cache-cleanup', {
  interval: 5 * 60 * 1000, // 5 minutes
  handler: cleanupExpiredCaches,
  options: {
    immediate: true, // Run on start
    retries: 2, // Override default
  },
})

// Cron expression
scheduler.register('daily-report', {
  cron: '0 9 * * *', // 9 AM daily
  handler: generateDailyReport,
})
```

### Lifecycle Control

```typescript
// Start individual or all tasks
scheduler.start('cache-cleanup')
scheduler.startAll()

// Stop gracefully
scheduler.stop('cache-cleanup')
await scheduler.stopAll() // Waits for active handlers
```

### Event Hooks

```typescript
scheduler.on('tick', ({ name, duration }) => {
  logger.debug({ task: name, durationMs: duration }, 'Task completed')
})

scheduler.on('error', ({ name, error, attempt }) => {
  logger.error({ task: name, error, attempt }, 'Task failed, will retry')
})

scheduler.on('fatalError', ({ name, error }) => {
  logger.error({ task: name, error }, 'Task failed permanently')
  // Alert on-call, etc.
})
```

### Error Types

```typescript
import { RetryableError, FatalError } from './utils/scheduler.js'

async function myTask() {
  try {
    await riskyOperation()
  } catch (err) {
    if (isNetworkError(err)) {
      // Will retry with backoff
      throw new RetryableError('Network hiccup', { cause: err })
    }
    // Stops retrying immediately
    throw new FatalError('Config error', { cause: err })
  }
}
```

---

## Migration Plan

### Phase 1: Create Scheduler Utility

- Implement `src/utils/scheduler.ts`
- Add comprehensive unit tests
- Add integration tests
- **No breaking changes**

### Phase 2: Migrate Module-Level Intervals

Files with module-level `setInterval` (no cleanup):

- `src/cache.ts:43` - User cache TTL cleanup
- `src/message-cache/cache.ts:14` - Message cache sweep
- `src/message-cache/persistence.ts:100` - Hourly DB cleanup

**Example migration:**

```typescript
// Before
setInterval(
  () => {
    const now = Date.now()
    for (const [userId, cache] of userCaches) {
      if (now - cache.lastAccessed > SESSION_TTL_MS) {
        userCaches.delete(userId)
      }
    }
  },
  5 * 60 * 1000,
)

// After
scheduler.register('user-cache-cleanup', {
  interval: 5 * 60 * 1000,
  handler: () => {
    const now = Date.now()
    for (const [userId, cache] of userCaches) {
      if (now - cache.lastAccessed > SESSION_TTL_MS) {
        userCaches.delete(userId)
      }
    }
  },
  options: { immediate: true },
})
scheduler.startAll()
```

### Phase 3: Migrate Managed Intervals

Files with existing start/stop patterns:

- `src/scheduler.ts:229` - Recurring task scheduler
- `src/deferred-prompts/poller.ts:258-264` - Deferred prompt pollers

Refactor to use centralized scheduler for consistency.

### Phase 4: Cleanup

- Remove old interval patterns
- Update developer documentation
- Add lint rule to prevent raw `setInterval`

---

## Testing Strategy

### Unit Tests (`tests/utils/scheduler.test.ts`)

- Registration and validation
- Start/stop lifecycle
- Retry logic with mocked failures
- Event hook firing
- Cron expression parsing (using `Bun.cron.parse`)

### Integration Tests

- Real intervals with short durations
- Graceful shutdown behavior
- Error recovery with actual async operations
- Memory leak verification

### Migration Tests

- Verify all existing intervals still execute
- Monitor error rates after migration
- Check process exit behavior

---

## Rollback Plan

Each phase is independent. If issues arise:

1. Revert specific file to previous `setInterval` implementation
2. Scheduler continues working for other tasks
3. No global state corruption

---

## Success Criteria

- [ ] All existing intervals migrated to scheduler
- [ ] No memory leaks over 24h runtime
- [ ] Errors in one task don't affect others
- [ ] Process can exit gracefully (SIGTERM handled)
- [ ] Test coverage > 90% for scheduler module
- [ ] No raw `setInterval` remains in `src/` (except in scheduler itself)

---

## Open Questions

1. Should we expose metrics (prometheus-style) for task execution times and error rates?
2. Should tasks have a "timeout" option to prevent runaway handlers?
3. Should we support task dependencies (task B runs after task A)?

---

## References

- Bun cron documentation: https://bun.sh/docs/runtime/cron
- Node.js timer best practices: https://httptoolkit.com/blog/unblocking-node-with-unref
- Bunqueue for advanced job queue needs: https://www.bunqueue.io/
