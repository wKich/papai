# Session 3: Instrument Source Modules — Design

**Date:** 2026-03-28
**Status:** Approved
**Parent:** `2026-03-27-debug-tracing-tool-design.md` (Session 3)
**Scope:** Add `emit()` calls to source modules, expand `state-collector.ts` into central state hub, add snapshot facade functions

## Overview

Instrument 8 source modules with debug event emission via the existing `event-bus.ts`. Expand `state-collector.ts` from a simple SSE pipe into a stateful hub that filters by admin user, maintains global stats counters, accumulates LLM traces, and bootstraps new SSE clients with full system state.

## Architecture: Hybrid Pattern (Events + Facade Query)

Two mechanisms, each solving a different problem:

1. **`emit()` calls in source modules** — real-time lifecycle events forwarded to SSE clients via the existing event bus. Zero overhead when no debug clients connected (`listeners.size === 0` guard).

2. **Snapshot facade functions** — each stateful module exports a narrow, read-only function returning sanitized state. Called once by `state-collector.ts` on SSE connect to populate `state:init`. No polling, no timers.

### Dependency Graph

```
bot.ts ──────────────┐
llm-orchestrator.ts ─┤── import { emit } from ──> event-bus.ts <── subscribe ── state-collector.ts
cache.ts ────────────┤                                                              |
conversation.ts ─────┤                                                              |
wizard/state.ts ─────┤                                                              |
scheduler.ts ────────┤                                                              |
poller.ts ───────────┤                                                              |
message-cache/ ──────┘                                                              |
                                                                                    |
cache.ts ─────────── export getSessionSnapshots() <── import ───────────────────────┘
wizard/state.ts ──── export getWizardSnapshots()  <── import ───────────────────────┘
scheduler.ts ─────── export getSchedulerSnapshot() <── import ──────────────────────┘
poller.ts ────────── export getPollerSnapshot()   <── import ───────────────────────┘
message-cache/ ───── export getMessageCacheSnapshot() <── import ───────────────────┘
```

- Source modules import only `emit` from `event-bus.ts` (existing infra)
- `state-collector.ts` imports snapshot functions from each module (narrow, purpose-designed APIs)
- No module imports `_userCaches`. No new patterns introduced.

## Security Boundary

All `emit()` calls fire unconditionally — source modules have no awareness of admin filtering. **`state-collector.ts` is the single security gate:**

1. **At init:** receives `adminUserId` from `startDebugServer(adminUserId)`
2. **Lifecycle events:** `onEvent()` checks `event.data.userId` — drops non-admin events before broadcasting
3. **Snapshot queries:** passes `adminUserId` as filter — `getSessionSnapshots(adminUserId)` returns only the admin's session
4. **Global state** (scheduler, pollers, message-cache, stats): no user data, broadcast unfiltered
5. **Tool call results:** `experimental_onToolCallFinish` payload excludes `output` (may contain task titles, descriptions, user content). Only `success`, `durationMs`, and `error` are emitted.

```
index.ts
  └─ startDebugServer(adminUserId)
       └─ stateCollector.init(adminUserId)
            ├─ onEvent(event) -> drop if event.data.userId !== adminUserId
            ├─ getSessionSnapshots(adminUserId) -> single session
            ├─ getWizardSnapshots(adminUserId) -> admin's wizard only
            └─ recentLlm ring buffer -> only stores admin traces
```

Aggregate stats (`totalMessages`, `totalLlmCalls`, `totalToolCalls`) count admin events only but expose no identifying data — these remain unfiltered.

## State Snapshots

Each module exports a read-only snapshot function. Called once on SSE connect for `state:init`, then kept current via lifecycle events.

### `cache.ts` — `getSessionSnapshots(userId: string): SessionSnapshot[]`

```typescript
type SessionSnapshot = {
  userId: string
  lastAccessed: number
  historyLength: number
  summary: string | null
  factsCount: number
  facts: Array<{ identifier: string; title: string; url: string; lastSeen: string }>
  configKeys: string[]
  workspaceId: string | null
  hasTools: boolean
  instructionsCount: number
}
```

Iterates `userCaches`, filtered to `userId`. Config values are omitted (may contain secrets); only keys are listed.

### `wizard/state.ts` — `getWizardSnapshots(userId: string): WizardSnapshot[]`

```typescript
type WizardSnapshot = {
  userId: string
  storageContextId: string
  startedAt: string
  currentStep: number
  totalSteps: number
  platform: 'telegram' | 'mattermost'
  taskProvider: 'kaneo' | 'youtrack'
  skippedSteps: number[]
  dataKeys: string[]
}
```

Iterates `activeSessions`, filtered to `userId`. Omits `data` values (may contain API keys mid-entry).

### `scheduler.ts` — `getSchedulerSnapshot(): SchedulerSnapshot`

```typescript
type SchedulerSnapshot = {
  running: boolean
  tickCount: number
  tickIntervalMs: number
  heartbeatInterval: number
  activeTickInProgress: boolean
  taskProvider: string
}
```

### `deferred-prompts/poller.ts` — `getPollerSnapshot(): PollerSnapshot`

```typescript
type PollerSnapshot = {
  scheduledRunning: boolean
  alertsRunning: boolean
  scheduledIntervalMs: number
  alertIntervalMs: number
  maxConcurrentLlmCalls: number
  maxConcurrentUsers: number
}
```

### `message-cache/cache.ts` — `getMessageCacheSnapshot(): MessageCacheSnapshot`

```typescript
type MessageCacheSnapshot = {
  size: number
  ttlMs: number
  pendingWrites: number
  isFlushScheduled: boolean
}
```

`pendingWrites` and `isFlushScheduled` are exposed via two new accessors in `message-cache/persistence.ts`: `getPendingWritesCount()` and `getIsFlushScheduled()`.

### Assembled `state:init` Payload

```typescript
{
  sessions: SessionSnapshot[]
  wizards: WizardSnapshot[]
  scheduler: SchedulerSnapshot
  pollers: PollerSnapshot
  messageCache: MessageCacheSnapshot
  stats: { startedAt: number; totalMessages: number; totalLlmCalls: number; totalToolCalls: number }
  recentLlm: LlmTrace[]
}
```

## Lifecycle Events

All events carry `userId` in their payload where applicable. `state-collector.ts` filters before broadcast.

### `bot.ts` — 3 emit points

| Event | Location | Payload |
|---|---|---|
| `message:received` | `chat.onMessage` callback, before auth check | `{ userId, contextId, contextType, textLength, isCommand }` |
| `auth:check` | After `checkAuthorizationExtended` returns | `{ userId, allowed, isBotAdmin, isGroupAdmin, storageContextId }` |
| `message:replied` | After `handleMessage` completes (wrap with timing) | `{ userId, contextId, duration }` |

Duration measurement: capture `const start = Date.now()` before `handleMessage`, emit after it resolves/rejects.

### `llm-orchestrator.ts` — 5 emit points via SDK callbacks

| SDK Callback | Stability | Debug Event | Payload |
|---|---|---|---|
| `experimental_onStart` | experimental | `llm:start` | `{ userId, model: event.model.modelId, messageCount, toolCount }` |
| `experimental_onToolCallStart` | experimental | `llm:tool_call` | `{ userId, toolName, toolCallId, args: event.input }` |
| `experimental_onToolCallFinish` | experimental | `llm:tool_result` | `{ userId, toolName, toolCallId, durationMs, success, error? }` |
| *(manual, after generateText)* | — | `llm:end` | `{ userId, model, steps, totalDuration, tokenUsage }` |
| *(catch block)* | — | `llm:error` | `{ userId, error, model }` |

`onFinish` does not provide wall-clock duration. `const start = Date.now()` is captured before `generateText()` and `duration = Date.now() - start` is computed after it returns.

Tool call `output` is **excluded** from `llm:tool_result` — may contain user content. Only `success`, `durationMs`, and `error` are safe.

### `cache.ts` — 3 event types, 15 emit points

| Event | Emit points | Payload |
|---|---|---|
| `cache:load` | 6 cache-miss branches (history, summary, facts, config, workspace, instructions) | `{ userId, field }` |
| `cache:sync` | 8 mutation functions (set/append history, set summary, upsert fact, set config, set workspace, add/delete instruction) | `{ userId, field, operation }` |
| `cache:expire` | TTL cleanup `setInterval` (one event per expired user) | `{ userId }` |

No config values, no summary text, no fact content, no history messages — only field names and operation types.

### `conversation.ts` — 2 events

| Event | Location | Payload |
|---|---|---|
| `trim:start` | `runTrimInBackground` entry | `{ userId, historyLength, reason }` |
| `trim:end` | After success (line 55) or catch (line 57) | `{ userId, kept, dropped, success }` or `{ userId, error, success: false }` |

### `wizard/state.ts` — 3 events

| Event | Location | Payload |
|---|---|---|
| `wizard:created` | `createWizardSession`, after `activeSessions.set()` | `{ userId, storageContextId, totalSteps, platform, taskProvider }` |
| `wizard:updated` | `updateWizardSession`, after mutation | `{ userId, storageContextId, currentStep }` |
| `wizard:deleted` | `deleteWizardSession`, after `activeSessions.delete()` | `{ userId, storageContextId }` |

### `scheduler.ts` — 2 events

| Event | Location | Payload |
|---|---|---|
| `scheduler:tick` | `tick()`, after `tickCount++` | `{ tickCount, dueTaskCount }` |
| `scheduler:task_executed` | `executeRecurringTask`, on success | `{ userId, recurringTaskId, createdTaskId }` |

`scheduler:tick` has no `userId` — global event, passes through unfiltered. `scheduler:task_executed` carries `userId` — filtered by `state-collector.ts`.

### `deferred-prompts/poller.ts` — 2 events

| Event | Location | Payload |
|---|---|---|
| `poller:scheduled` | `pollScheduledOnce`, after querying due prompts | `{ dueCount }` |
| `poller:alerts` | `pollAlertsOnce`, after querying eligible alerts | `{ eligibleCount }` |

No `userId` — global events, unfiltered.

### `message-cache/cache.ts` — 1 event

| Event | Location | Payload |
|---|---|---|
| `msgcache:sweep` | Daily sweep `setInterval`, after deletion loop | `{ swept, remaining }` |

No `userId` — global event, unfiltered.

## State-Collector Expansion

`state-collector.ts` grows from ~47 lines to ~150-180 lines. Three new responsibilities:

### Admin Filtering

```typescript
let adminUserId: string | null = null

export function init(adminId: string): void {
  adminUserId = adminId
}

function onEvent(event: DebugEvent): void {
  const eventUserId = event.data.userId
  if (typeof eventUserId === 'string' && eventUserId !== adminUserId) return
  // ... process and broadcast
}
```

### Global Stats Counters

```typescript
const stats = {
  startedAt: Date.now(),
  totalMessages: 0,
  totalLlmCalls: 0,
  totalToolCalls: 0,
}
```

Incremented on `message:received`, `llm:end`, `llm:tool_result` (admin events only, post-filter). Broadcasts `state:stats` debounced ~500ms.

### LLM Trace Ring Buffer

```typescript
const LLM_TRACE_CAPACITY = 65535

type LlmTrace = {
  timestamp: number
  userId: string
  model: string
  steps: number
  totalTokens: { inputTokens: number; outputTokens: number }
  duration: number
  toolCalls: Array<{ toolName: string; durationMs: number; success: boolean }>
  error?: string
}
```

Built from `llm:start` -> `llm:tool_call`/`llm:tool_result` -> `llm:end`/`llm:error` event sequences. On `llm:end`, the accumulated trace is pushed to the buffer and broadcast as `llm:full`.

### State Snapshot Broadcasts

| Snapshot event | Triggered by | Data |
|---|---|---|
| `state:sessions` | Any `cache:*` event for admin | `getSessionSnapshots(adminUserId)` |
| `state:cache` | `cache:sync` / `cache:load` for admin | Full admin session snapshot |
| `state:stats` | `message:received` / `llm:end` (debounced) | Current stats counters |
| `llm:full` | `llm:end` for admin | Complete LLM trace from ring buffer |

## Changes Summary

### New exports (snapshot functions)

| File | New export | ~Lines |
|---|---|---|
| `src/cache.ts` | `getSessionSnapshots(userId)` | ~15 |
| `src/wizard/state.ts` | `getWizardSnapshots(userId)` | ~10 |
| `src/scheduler.ts` | `getSchedulerSnapshot()` | ~8 |
| `src/deferred-prompts/poller.ts` | `getPollerSnapshot()` | ~6 |
| `src/message-cache/cache.ts` | `getMessageCacheSnapshot()` | ~6 |
| `src/message-cache/persistence.ts` | `getPendingWritesCount()`, `getIsFlushScheduled()` | ~4 |

### `emit()` calls added

| File | Emit calls | ~Lines added |
|---|---|---|
| `src/bot.ts` | 3 (`message:received`, `auth:check`, `message:replied`) | ~10 |
| `src/llm-orchestrator.ts` | 5 via SDK callbacks + catch block | ~20 |
| `src/cache.ts` | 15 (6 loads + 8 syncs + 1 expiry) | ~16 |
| `src/conversation.ts` | 2 (`trim:start`, `trim:end`) | ~6 |
| `src/wizard/state.ts` | 3 (`created`, `updated`, `deleted`) | ~4 |
| `src/scheduler.ts` | 2 (`tick`, `task_executed`) | ~4 |
| `src/deferred-prompts/poller.ts` | 2 (`scheduled`, `alerts`) | ~3 |
| `src/message-cache/cache.ts` | 1 (`sweep`) | ~2 |

### Modified files

| File | Change | ~Lines |
|---|---|---|
| `src/debug/state-collector.ts` | Rewrite: admin filtering, stats, LLM trace buffer, snapshots | ~150-180 |
| `src/debug/server.ts` | `startDebugServer(adminUserId)` signature, passes to `init()` | ~3 |
| `src/index.ts` | `startDebugServer(adminUserId)` call | ~1 |

### Total

~50 snapshot lines + ~65 emit lines + ~130 state-collector lines + ~4 wiring = **~250 lines of new/changed code**

## Acceptance Criteria

- SSE stream shows real-time events when sending messages to the bot as admin
- Non-admin user events are filtered out — never appear in SSE stream
- `state:init` fires on new SSE connection with full current state (sessions, wizards, scheduler, pollers, message cache, stats, recent LLM calls)
- State snapshots reflect actual in-memory state accurately
- Tool call outputs are never exposed in debug events
- Config values (API keys, tokens) are never exposed — only key names
- Zero overhead when `DEBUG_SERVER` not set (no listeners = no-op)
- All existing tests continue to pass (`bun test`)
