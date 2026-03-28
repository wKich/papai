# Session 3: Instrument Source Modules — Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Instrument 8 source modules with debug event emission, expand state-collector into a stateful hub with admin filtering, and add snapshot facade functions for SSE bootstrap.

**Architecture:** Hybrid pattern — `emit()` calls in source modules for real-time events, snapshot facade functions for cold-start bootstrap on SSE connect. `state-collector.ts` is the single security gate (admin-only filtering). See `docs/plans/2026-03-28-session3-instrument-source-modules-design.md`.

**Tech Stack:** Bun, TypeScript, Vercel AI SDK v6 (`experimental_onToolCallStart`/`experimental_onToolCallFinish` callbacks), existing `event-bus.ts` pub/sub

---

### Task 1: Snapshot facade — `message-cache/persistence.ts` accessors

**Files:**

- Modify: `src/message-cache/persistence.ts:11-12`
- Test: `tests/debug/snapshots.test.ts`

**Step 1: Write the failing test**

Create `tests/debug/snapshots.test.ts`:

```typescript
import { describe, expect, test } from 'bun:test'

import { getPendingWritesCount, getIsFlushScheduled } from '../../src/message-cache/persistence.js'

describe('message-cache persistence accessors', () => {
  test('getPendingWritesCount returns a number', () => {
    const count = getPendingWritesCount()
    expect(typeof count).toBe('number')
    expect(count).toBeGreaterThanOrEqual(0)
  })

  test('getIsFlushScheduled returns a boolean', () => {
    const scheduled = getIsFlushScheduled()
    expect(typeof scheduled).toBe('boolean')
  })
})
```

**Step 2: Run test to verify it fails**

Run: `bun test tests/debug/snapshots.test.ts`
Expected: FAIL — `getPendingWritesCount` is not exported

**Step 3: Write minimal implementation**

Add to end of `src/message-cache/persistence.ts`:

```typescript
export function getPendingWritesCount(): number {
  return pendingWrites.size
}

export function getIsFlushScheduled(): boolean {
  return isFlushScheduled
}
```

**Step 4: Run test to verify it passes**

Run: `bun test tests/debug/snapshots.test.ts`
Expected: PASS

**Step 5: Commit**

```bash
git add src/message-cache/persistence.ts tests/debug/snapshots.test.ts
git commit -m "feat(debug): add persistence accessors for debug snapshots"
```

---

### Task 2: Snapshot facade — `getMessageCacheSnapshot()`

**Files:**

- Modify: `src/message-cache/cache.ts`
- Modify: `tests/debug/snapshots.test.ts`

**Step 1: Write the failing test**

Add to `tests/debug/snapshots.test.ts`:

```typescript
import { getMessageCacheSnapshot } from '../../src/message-cache/cache.js'

describe('getMessageCacheSnapshot', () => {
  test('returns snapshot with expected shape', () => {
    const snap = getMessageCacheSnapshot()
    expect(snap).toHaveProperty('size')
    expect(snap).toHaveProperty('ttlMs')
    expect(snap).toHaveProperty('pendingWrites')
    expect(snap).toHaveProperty('isFlushScheduled')
    expect(typeof snap.size).toBe('number')
    expect(typeof snap.ttlMs).toBe('number')
    expect(snap.ttlMs).toBe(7 * 24 * 60 * 60 * 1000)
  })
})
```

**Step 2: Run test to verify it fails**

Run: `bun test tests/debug/snapshots.test.ts`
Expected: FAIL — `getMessageCacheSnapshot` is not exported

**Step 3: Write minimal implementation**

Add to `src/message-cache/cache.ts`:

```typescript
import { getPendingWritesCount, getIsFlushScheduled } from './persistence.js'

export type MessageCacheSnapshot = {
  size: number
  ttlMs: number
  pendingWrites: number
  isFlushScheduled: boolean
}

export function getMessageCacheSnapshot(): MessageCacheSnapshot {
  return {
    size: messageCache.size,
    ttlMs: ONE_WEEK_MS,
    pendingWrites: getPendingWritesCount(),
    isFlushScheduled: getIsFlushScheduled(),
  }
}
```

**Step 4: Run test to verify it passes**

Run: `bun test tests/debug/snapshots.test.ts`
Expected: PASS

**Step 5: Commit**

```bash
git add src/message-cache/cache.ts tests/debug/snapshots.test.ts
git commit -m "feat(debug): add getMessageCacheSnapshot facade"
```

---

### Task 3: Snapshot facade — `getSchedulerSnapshot()`

**Files:**

- Modify: `src/scheduler.ts:23-29`
- Modify: `tests/debug/snapshots.test.ts`

**Step 1: Write the failing test**

Add to `tests/debug/snapshots.test.ts`:

```typescript
import { getSchedulerSnapshot } from '../../src/scheduler.js'

describe('getSchedulerSnapshot', () => {
  test('returns snapshot with expected shape', () => {
    const snap = getSchedulerSnapshot()
    expect(snap).toHaveProperty('running')
    expect(snap).toHaveProperty('tickCount')
    expect(snap).toHaveProperty('tickIntervalMs')
    expect(snap).toHaveProperty('heartbeatInterval')
    expect(snap).toHaveProperty('activeTickInProgress')
    expect(snap).toHaveProperty('taskProvider')
    expect(typeof snap.running).toBe('boolean')
    expect(typeof snap.tickCount).toBe('number')
    expect(snap.tickIntervalMs).toBe(60_000)
    expect(snap.heartbeatInterval).toBe(60)
  })

  test('reports not running when scheduler is stopped', () => {
    const snap = getSchedulerSnapshot()
    expect(snap.running).toBe(false)
    expect(snap.activeTickInProgress).toBe(false)
  })
})
```

**Step 2: Run test to verify it fails**

Run: `bun test tests/debug/snapshots.test.ts`
Expected: FAIL — `getSchedulerSnapshot` is not exported

**Step 3: Write minimal implementation**

Add to `src/scheduler.ts`:

```typescript
export type SchedulerSnapshot = {
  running: boolean
  tickCount: number
  tickIntervalMs: number
  heartbeatInterval: number
  activeTickInProgress: boolean
  taskProvider: string
}

export function getSchedulerSnapshot(): SchedulerSnapshot {
  return {
    running: intervalId !== null,
    tickCount,
    tickIntervalMs: TICK_INTERVAL_MS,
    heartbeatInterval: HEARTBEAT_INTERVAL,
    activeTickInProgress: activeTickPromise !== null,
    taskProvider: TASK_PROVIDER,
  }
}
```

**Step 4: Run test to verify it passes**

Run: `bun test tests/debug/snapshots.test.ts`
Expected: PASS

**Step 5: Commit**

```bash
git add src/scheduler.ts tests/debug/snapshots.test.ts
git commit -m "feat(debug): add getSchedulerSnapshot facade"
```

---

### Task 4: Snapshot facade — `getPollerSnapshot()`

**Files:**

- Modify: `src/deferred-prompts/poller.ts:17-23`
- Modify: `tests/debug/snapshots.test.ts`

**Step 1: Write the failing test**

Add to `tests/debug/snapshots.test.ts`:

```typescript
import { getPollerSnapshot } from '../../src/deferred-prompts/poller.js'

describe('getPollerSnapshot', () => {
  test('returns snapshot with expected shape', () => {
    const snap = getPollerSnapshot()
    expect(snap).toHaveProperty('scheduledRunning')
    expect(snap).toHaveProperty('alertsRunning')
    expect(snap).toHaveProperty('scheduledIntervalMs')
    expect(snap).toHaveProperty('alertIntervalMs')
    expect(snap).toHaveProperty('maxConcurrentLlmCalls')
    expect(snap).toHaveProperty('maxConcurrentUsers')
    expect(snap.scheduledIntervalMs).toBe(60_000)
    expect(snap.alertIntervalMs).toBe(300_000)
    expect(snap.maxConcurrentLlmCalls).toBe(5)
    expect(snap.maxConcurrentUsers).toBe(10)
  })

  test('reports not running when pollers are stopped', () => {
    const snap = getPollerSnapshot()
    expect(snap.scheduledRunning).toBe(false)
    expect(snap.alertsRunning).toBe(false)
  })
})
```

**Step 2: Run test to verify it fails**

Run: `bun test tests/debug/snapshots.test.ts`
Expected: FAIL — `getPollerSnapshot` is not exported

**Step 3: Write minimal implementation**

Add to `src/deferred-prompts/poller.ts`:

```typescript
export type PollerSnapshot = {
  scheduledRunning: boolean
  alertsRunning: boolean
  scheduledIntervalMs: number
  alertIntervalMs: number
  maxConcurrentLlmCalls: number
  maxConcurrentUsers: number
}

export function getPollerSnapshot(): PollerSnapshot {
  return {
    scheduledRunning: scheduledIntervalId !== null,
    alertsRunning: alertIntervalId !== null,
    scheduledIntervalMs: SCHEDULED_POLL_MS,
    alertIntervalMs: ALERT_POLL_MS,
    maxConcurrentLlmCalls: MAX_CONCURRENT_LLM_CALLS,
    maxConcurrentUsers: MAX_CONCURRENT_USERS,
  }
}
```

**Step 4: Run test to verify it passes**

Run: `bun test tests/debug/snapshots.test.ts`
Expected: PASS

**Step 5: Commit**

```bash
git add src/deferred-prompts/poller.ts tests/debug/snapshots.test.ts
git commit -m "feat(debug): add getPollerSnapshot facade"
```

---

### Task 5: Snapshot facade — `getWizardSnapshots()`

**Files:**

- Modify: `src/wizard/state.ts:31`
- Modify: `tests/debug/snapshots.test.ts`

**Step 1: Write the failing test**

Add to `tests/debug/snapshots.test.ts`:

```typescript
import { getWizardSnapshots } from '../../src/wizard/state.js'
import { createWizardSession, deleteWizardSession } from '../../src/wizard/state.js'

describe('getWizardSnapshots', () => {
  test('returns empty array when no sessions exist', () => {
    const snaps = getWizardSnapshots('nonexistent-user')
    expect(snaps).toEqual([])
  })

  test('returns only sessions for requested userId', () => {
    createWizardSession({
      userId: 'admin-1',
      storageContextId: 'admin-1',
      totalSteps: 5,
      platform: 'telegram',
      taskProvider: 'kaneo',
    })
    createWizardSession({
      userId: 'other-user',
      storageContextId: 'other-user',
      totalSteps: 5,
      platform: 'telegram',
      taskProvider: 'kaneo',
    })

    const snaps = getWizardSnapshots('admin-1')
    expect(snaps).toHaveLength(1)
    expect(snaps[0]!.userId).toBe('admin-1')
    expect(snaps[0]!).toHaveProperty('currentStep')
    expect(snaps[0]!).toHaveProperty('totalSteps')
    expect(snaps[0]!).toHaveProperty('platform')
    expect(snaps[0]!).toHaveProperty('taskProvider')
    expect(snaps[0]!).toHaveProperty('skippedSteps')
    expect(snaps[0]!).toHaveProperty('dataKeys')
    expect(snaps[0]!).not.toHaveProperty('data')

    // Cleanup
    deleteWizardSession('admin-1', 'admin-1')
    deleteWizardSession('other-user', 'other-user')
  })
})
```

**Step 2: Run test to verify it fails**

Run: `bun test tests/debug/snapshots.test.ts`
Expected: FAIL — `getWizardSnapshots` is not exported

**Step 3: Write minimal implementation**

Add to `src/wizard/state.ts`:

```typescript
export type WizardSnapshot = {
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

export function getWizardSnapshots(userId: string): WizardSnapshot[] {
  const snapshots: WizardSnapshot[] = []
  for (const session of activeSessions.values()) {
    if (session.userId !== userId) continue
    snapshots.push({
      userId: session.userId,
      storageContextId: session.storageContextId,
      startedAt: session.startedAt.toISOString(),
      currentStep: session.currentStep,
      totalSteps: session.totalSteps,
      platform: session.platform,
      taskProvider: session.taskProvider,
      skippedSteps: [...session.skippedSteps],
      dataKeys: Object.keys(session.data),
    })
  }
  return snapshots
}
```

**Step 4: Run test to verify it passes**

Run: `bun test tests/debug/snapshots.test.ts`
Expected: PASS

**Step 5: Commit**

```bash
git add src/wizard/state.ts tests/debug/snapshots.test.ts
git commit -m "feat(debug): add getWizardSnapshots facade"
```

---

### Task 6: Snapshot facade — `getSessionSnapshots()`

**Files:**

- Modify: `src/cache.ts`
- Modify: `tests/debug/snapshots.test.ts`

**Step 1: Write the failing test**

Add to `tests/debug/snapshots.test.ts`:

```typescript
import { getSessionSnapshots } from '../../src/cache.js'
import { _userCaches } from '../../src/cache.js'

describe('getSessionSnapshots', () => {
  afterEach(() => {
    _userCaches.clear()
  })

  test('returns empty array when no sessions exist', () => {
    const snaps = getSessionSnapshots('nonexistent')
    expect(snaps).toEqual([])
  })

  test('returns only sessions for requested userId', () => {
    // Manually populate caches to avoid DB dependency
    _userCaches.set('admin-1', {
      history: [{ role: 'user', content: 'hello' }],
      summary: 'test summary',
      facts: [{ identifier: 'TASK-1', title: 'Fix bug', url: 'http://example.com', last_seen: '2026-03-28' }],
      instructions: [{ id: 'i1', text: 'be concise', createdAt: '2026-03-28' }],
      config: new Map([
        ['llm_apikey', 'sk-test'],
        ['main_model', 'gpt-4o'],
      ]),
      workspaceId: 'ws-1',
      tools: {},
      lastAccessed: Date.now(),
    })
    _userCaches.set('other-user', {
      history: [],
      summary: null,
      facts: [],
      instructions: null,
      config: new Map(),
      workspaceId: null,
      tools: null,
      lastAccessed: Date.now(),
    })

    const snaps = getSessionSnapshots('admin-1')
    expect(snaps).toHaveLength(1)
    expect(snaps[0]!.userId).toBe('admin-1')
    expect(snaps[0]!.historyLength).toBe(1)
    expect(snaps[0]!.summary).toBe('test summary')
    expect(snaps[0]!.factsCount).toBe(1)
    expect(snaps[0]!.facts).toHaveLength(1)
    expect(snaps[0]!.configKeys).toContain('llm_apikey')
    expect(snaps[0]!.configKeys).toContain('main_model')
    expect(snaps[0]!.workspaceId).toBe('ws-1')
    expect(snaps[0]!.hasTools).toBe(true)
    expect(snaps[0]!.instructionsCount).toBe(1)
  })

  test('does not expose config values', () => {
    _userCaches.set('admin-1', {
      history: [],
      summary: null,
      facts: [],
      instructions: null,
      config: new Map([['llm_apikey', 'sk-secret-key']]),
      workspaceId: null,
      tools: null,
      lastAccessed: Date.now(),
    })

    const snaps = getSessionSnapshots('admin-1')
    const snap = snaps[0]!
    // configKeys contains key names, not values
    expect(snap.configKeys).toContain('llm_apikey')
    // The snapshot type should not have a 'config' map with values
    expect(snap).not.toHaveProperty('config')
  })
})
```

Note: Add `import { afterEach } from 'bun:test'` to the existing imports at top of file.

**Step 2: Run test to verify it fails**

Run: `bun test tests/debug/snapshots.test.ts`
Expected: FAIL — `getSessionSnapshots` is not exported

**Step 3: Write minimal implementation**

Add to `src/cache.ts`:

```typescript
export type SessionSnapshot = {
  userId: string
  lastAccessed: number
  historyLength: number
  summary: string | null
  factsCount: number
  facts: ReadonlyArray<{ identifier: string; title: string; url: string; lastSeen: string }>
  configKeys: string[]
  workspaceId: string | null
  hasTools: boolean
  instructionsCount: number
}

export function getSessionSnapshots(userId: string): SessionSnapshot[] {
  const snapshots: SessionSnapshot[] = []
  for (const [id, cache] of userCaches) {
    if (id !== userId) continue
    const configKeys: string[] = []
    for (const [key, value] of cache.config) {
      if (value !== null && !key.endsWith('_loaded')) configKeys.push(key)
    }
    snapshots.push({
      userId: id,
      lastAccessed: cache.lastAccessed,
      historyLength: cache.history.length,
      summary: cache.summary,
      factsCount: cache.facts.length,
      facts: cache.facts.map((f) => ({
        identifier: f.identifier,
        title: f.title,
        url: f.url,
        lastSeen: f.last_seen,
      })),
      configKeys,
      workspaceId: cache.workspaceId,
      hasTools: cache.tools !== null,
      instructionsCount: cache.instructions?.length ?? 0,
    })
  }
  return snapshots
}
```

**Step 4: Run test to verify it passes**

Run: `bun test tests/debug/snapshots.test.ts`
Expected: PASS

**Step 5: Commit**

```bash
git add src/cache.ts tests/debug/snapshots.test.ts
git commit -m "feat(debug): add getSessionSnapshots facade"
```

---

### Task 7: Rewrite `state-collector.ts` — admin filtering + stats + LLM trace buffer

**Files:**

- Rewrite: `src/debug/state-collector.ts`
- Test: `tests/debug/state-collector.test.ts`

**Step 1: Write the failing tests**

Replace `tests/debug/state-collector.test.ts` entirely:

```typescript
import { afterEach, describe, expect, mock, test } from 'bun:test'

import { emit } from '../../src/debug/event-bus.js'
import { addClient, init, removeClient } from '../../src/debug/state-collector.js'

type MockController = {
  ctrl: ReadableStreamDefaultController
  enqueueMock: ReturnType<typeof mock<(chunk: unknown) => void>>
}

function createMockController(): MockController {
  const enqueueMock = mock<(chunk: unknown) => void>(() => {})
  const closeMock = mock(() => {})
  const ctrl: ReadableStreamDefaultController = {
    enqueue: (chunk: unknown): void => enqueueMock(chunk),
    close: (): void => closeMock(),
    error: (): void => {},
    desiredSize: 1,
  }
  return { ctrl, enqueueMock }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null
}

function parseSsePayload(call: [unknown]): { event: string; data: Record<string, unknown> } {
  const raw = new Uint8Array(call[0] instanceof Uint8Array ? call[0] : [])
  const text = new TextDecoder().decode(raw)
  const eventMatch = text.match(/^event: (.+)$/m)
  const dataMatch = text.match(/^data: (.+)$/m)
  const parsed: unknown = JSON.parse(dataMatch?.[1] ?? '{}')
  return {
    event: eventMatch?.[1] ?? '',
    data: isRecord(parsed) ? parsed : {},
  }
}

function getAllSseEvents(
  enqueueMock: MockController['enqueueMock'],
): Array<{ event: string; data: Record<string, unknown> }> {
  return enqueueMock.mock.calls.map((call) => parseSsePayload(call as [unknown]))
}

describe('state-collector', () => {
  const controllers: ReadableStreamDefaultController[] = []

  afterEach(() => {
    for (const ctrl of controllers) removeClient(ctrl)
    controllers.length = 0
  })

  function track(ctrl: ReadableStreamDefaultController): ReadableStreamDefaultController {
    controllers.push(ctrl)
    return ctrl
  }

  test('addClient sends state:init immediately', () => {
    init('admin-1')
    const { ctrl, enqueueMock } = createMockController()
    addClient(track(ctrl))

    expect(enqueueMock).toHaveBeenCalledTimes(1)
    const { event, data } = parseSsePayload(enqueueMock.mock.calls[0] as [unknown])
    expect(event).toBe('state:init')
    expect(data['type']).toBe('state:init')
  })

  test('state:init contains all snapshot sections', () => {
    init('admin-1')
    const { ctrl, enqueueMock } = createMockController()
    addClient(track(ctrl))

    const { data } = parseSsePayload(enqueueMock.mock.calls[0] as [unknown])
    const initData = data['data'] as Record<string, unknown>
    expect(initData).toHaveProperty('sessions')
    expect(initData).toHaveProperty('wizards')
    expect(initData).toHaveProperty('scheduler')
    expect(initData).toHaveProperty('pollers')
    expect(initData).toHaveProperty('messageCache')
    expect(initData).toHaveProperty('stats')
    expect(initData).toHaveProperty('recentLlm')
  })

  test('admin events are broadcast to clients', () => {
    init('admin-1')
    const { ctrl, enqueueMock } = createMockController()
    addClient(track(ctrl))

    emit('message:received', { userId: 'admin-1', textLength: 10 })

    expect(enqueueMock).toHaveBeenCalledTimes(2) // state:init + event
    const events = getAllSseEvents(enqueueMock)
    expect(events[1]!.event).toBe('message:received')
  })

  test('non-admin user events are filtered out', () => {
    init('admin-1')
    const { ctrl, enqueueMock } = createMockController()
    addClient(track(ctrl))

    emit('message:received', { userId: 'other-user', textLength: 10 })

    expect(enqueueMock).toHaveBeenCalledTimes(1) // only state:init
  })

  test('global events (no userId) pass through unfiltered', () => {
    init('admin-1')
    const { ctrl, enqueueMock } = createMockController()
    addClient(track(ctrl))

    emit('scheduler:tick', { tickCount: 1, dueTaskCount: 0 })

    expect(enqueueMock).toHaveBeenCalledTimes(2) // state:init + event
    const events = getAllSseEvents(enqueueMock)
    expect(events[1]!.event).toBe('scheduler:tick')
  })

  test('removeClient stops delivery to that client', () => {
    init('admin-1')
    const { ctrl, enqueueMock } = createMockController()
    addClient(ctrl)
    removeClient(ctrl)

    emit('message:received', { userId: 'admin-1', textLength: 5 })

    expect(enqueueMock).toHaveBeenCalledTimes(1) // only state:init
  })

  test('dead client (enqueue throws) is removed silently', () => {
    init('admin-1')
    const { ctrl, enqueueMock: badEnqueue } = createMockController()
    const { ctrl: goodCtrl, enqueueMock: goodEnqueue } = createMockController()
    addClient(track(ctrl))
    addClient(track(goodCtrl))

    badEnqueue.mockImplementation(() => {
      throw new Error('stream closed')
    })

    expect(() => emit('test:event', { userId: 'admin-1' })).not.toThrow()

    badEnqueue.mockImplementation(() => {})
    emit('test:after', { userId: 'admin-1' })

    // Good client: state:init + test:event + test:after = 3
    expect(goodEnqueue).toHaveBeenCalledTimes(3)
  })
})
```

**Step 2: Run test to verify it fails**

Run: `bun test tests/debug/state-collector.test.ts`
Expected: FAIL — `init` is not exported from state-collector

**Step 3: Write the implementation**

Rewrite `src/debug/state-collector.ts`:

```typescript
import { getSessionSnapshots } from '../cache.js'
import { getPollerSnapshot } from '../deferred-prompts/poller.js'
import { getMessageCacheSnapshot } from '../message-cache/cache.js'
import { getSchedulerSnapshot } from '../scheduler.js'
import { getWizardSnapshots } from '../wizard/state.js'
import { subscribe, unsubscribe, type DebugEvent } from './event-bus.js'

let adminUserId: string | null = null

const clients = new Set<ReadableStreamDefaultController>()
const encoder = new TextEncoder()

const stats = {
  startedAt: Date.now(),
  totalMessages: 0,
  totalLlmCalls: 0,
  totalToolCalls: 0,
}

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

const recentLlm: LlmTrace[] = []

type PendingLlmTrace = {
  startTimestamp: number
  userId: string
  model: string
  toolCalls: Array<{ toolName: string; durationMs: number; success: boolean }>
}

const pendingTraces = new Map<string, PendingLlmTrace>()

export function init(adminId: string): void {
  adminUserId = adminId
}

export function addClient(controller: ReadableStreamDefaultController): void {
  clients.add(controller)

  const initData: Record<string, unknown> = {
    sessions: adminUserId !== null ? getSessionSnapshots(adminUserId) : [],
    wizards: adminUserId !== null ? getWizardSnapshots(adminUserId) : [],
    scheduler: getSchedulerSnapshot(),
    pollers: getPollerSnapshot(),
    messageCache: getMessageCacheSnapshot(),
    stats,
    recentLlm,
  }

  sendTo(controller, { type: 'state:init', timestamp: Date.now(), data: initData })

  if (clients.size === 1) {
    subscribe(onEvent)
  }
}

export function removeClient(controller: ReadableStreamDefaultController): void {
  clients.delete(controller)

  if (clients.size === 0) {
    unsubscribe(onEvent)
  }
}

function isAdminEvent(event: DebugEvent): boolean {
  const eventUserId = event.data['userId']
  if (typeof eventUserId !== 'string') return true // global event, no userId
  return eventUserId === adminUserId
}

let statsDebounceTimer: ReturnType<typeof setTimeout> | null = null

function scheduleStatsBroadcast(): void {
  if (statsDebounceTimer !== null) return
  statsDebounceTimer = setTimeout(() => {
    statsDebounceTimer = null
    broadcast({ type: 'state:stats', timestamp: Date.now(), data: { ...stats } })
  }, 500)
}

function handleLlmTraceAccumulation(event: DebugEvent): void {
  const userId = event.data['userId'] as string

  if (event.type === 'llm:start') {
    pendingTraces.set(userId, {
      startTimestamp: event.timestamp,
      userId,
      model: event.data['model'] as string,
      toolCalls: [],
    })
  } else if (event.type === 'llm:tool_result') {
    const pending = pendingTraces.get(userId)
    if (pending !== undefined) {
      pending.toolCalls.push({
        toolName: event.data['toolName'] as string,
        durationMs: event.data['durationMs'] as number,
        success: event.data['success'] as boolean,
      })
    }
    stats.totalToolCalls++
    scheduleStatsBroadcast()
  } else if (event.type === 'llm:end') {
    const pending = pendingTraces.get(userId)
    pendingTraces.delete(userId)
    const tokenUsage = event.data['tokenUsage'] as { inputTokens: number; outputTokens: number } | undefined
    const trace: LlmTrace = {
      timestamp: event.timestamp,
      userId,
      model: pending?.model ?? (event.data['model'] as string),
      steps: event.data['steps'] as number,
      totalTokens: tokenUsage ?? { inputTokens: 0, outputTokens: 0 },
      duration: event.data['totalDuration'] as number,
      toolCalls: pending?.toolCalls ?? [],
    }
    if (recentLlm.length >= LLM_TRACE_CAPACITY) recentLlm.shift()
    recentLlm.push(trace)
    stats.totalLlmCalls++
    scheduleStatsBroadcast()
    broadcast({ type: 'llm:full', timestamp: event.timestamp, data: trace as unknown as Record<string, unknown> })
  } else if (event.type === 'llm:error') {
    const pending = pendingTraces.get(userId)
    pendingTraces.delete(userId)
    const trace: LlmTrace = {
      timestamp: event.timestamp,
      userId,
      model: pending?.model ?? (event.data['model'] as string),
      steps: 0,
      totalTokens: { inputTokens: 0, outputTokens: 0 },
      duration: pending !== undefined ? event.timestamp - pending.startTimestamp : 0,
      toolCalls: pending?.toolCalls ?? [],
      error: event.data['error'] as string,
    }
    if (recentLlm.length >= LLM_TRACE_CAPACITY) recentLlm.shift()
    recentLlm.push(trace)
    broadcast({ type: 'llm:full', timestamp: event.timestamp, data: trace as unknown as Record<string, unknown> })
  }
}

function handleStatsUpdate(event: DebugEvent): void {
  if (event.type === 'message:received') {
    stats.totalMessages++
    scheduleStatsBroadcast()
  }
}

function onEvent(event: DebugEvent): void {
  if (!isAdminEvent(event)) return

  // Accumulate LLM traces and stats
  handleLlmTraceAccumulation(event)
  handleStatsUpdate(event)

  // Forward the raw event to all clients
  broadcast(event)
}

function broadcast(event: DebugEvent): void {
  const payload = formatSse(event)
  for (const client of clients) {
    try {
      client.enqueue(payload)
    } catch {
      clients.delete(client)
    }
  }
}

function sendTo(controller: ReadableStreamDefaultController, event: DebugEvent): void {
  try {
    controller.enqueue(formatSse(event))
  } catch {
    clients.delete(controller)
  }
}

function formatSse(event: DebugEvent): Uint8Array {
  return encoder.encode(`event: ${event.type}\ndata: ${JSON.stringify(event)}\n\n`)
}
```

**Step 4: Run test to verify it passes**

Run: `bun test tests/debug/state-collector.test.ts`
Expected: PASS

**Step 5: Run full test suite**

Run: `bun test`
Expected: All tests pass

**Step 6: Commit**

```bash
git add src/debug/state-collector.ts tests/debug/state-collector.test.ts
git commit -m "feat(debug): rewrite state-collector with admin filtering, stats, and LLM trace buffer"
```

---

### Task 8: Wire `adminUserId` through `server.ts` and `index.ts`

**Files:**

- Modify: `src/debug/server.ts:62`
- Modify: `src/index.ts:96`
- Test: `tests/debug/server.test.ts:23`

**Step 1: Update `src/debug/server.ts`**

Change the `startDebugServer` function signature:

```typescript
// Before:
export function startDebugServer(): void {
  logMultistream.add({ stream: logBufferStream })
// After:
export function startDebugServer(adminUserId: string): void {
  init(adminUserId)
  logMultistream.add({ stream: logBufferStream })
```

Add import at top:

```typescript
import { addClient, init, removeClient } from './state-collector.js'
```

(Replace the existing `import { addClient, removeClient }` line.)

**Step 2: Update `src/index.ts`**

Change line 96:

```typescript
// Before:
startDebugServer()
// After:
startDebugServer(adminUserId)
```

**Step 3: Update `tests/debug/server.test.ts`**

Change the `startDebugServer()` call in `beforeAll`:

```typescript
// Before:
startDebugServer()
// After:
startDebugServer('test-admin')
```

**Step 4: Run tests**

Run: `bun test tests/debug/server.test.ts`
Expected: PASS

**Step 5: Run full test suite**

Run: `bun test`
Expected: All tests pass

**Step 6: Commit**

```bash
git add src/debug/server.ts src/index.ts tests/debug/server.test.ts
git commit -m "feat(debug): wire adminUserId through server and index"
```

---

### Task 9: Instrument `bot.ts` — 3 emit points

**Files:**

- Modify: `src/bot.ts:1,202-234`
- Test: `tests/debug/instrumentation.test.ts`

**Step 1: Write the failing test**

Create `tests/debug/instrumentation.test.ts`:

```typescript
import { afterEach, describe, expect, test } from 'bun:test'

import { emit, subscribe, unsubscribe, type DebugEvent } from '../../src/debug/event-bus.js'

function collectEvents(filterType?: string): { events: DebugEvent[]; cleanup: () => void } {
  const events: DebugEvent[] = []
  const listener = (e: DebugEvent): void => {
    if (filterType === undefined || e.type === filterType) events.push(e)
  }
  subscribe(listener)
  return { events, cleanup: () => unsubscribe(listener) }
}

describe('bot.ts instrumentation', () => {
  test('emit is callable with message:received shape', () => {
    const { events, cleanup } = collectEvents('message:received')
    emit('message:received', {
      userId: 'user-1',
      contextId: 'ctx-1',
      contextType: 'dm',
      textLength: 12,
      isCommand: false,
    })
    expect(events).toHaveLength(1)
    expect(events[0]!.data['userId']).toBe('user-1')
    expect(events[0]!.data['textLength']).toBe(12)
    cleanup()
  })

  test('emit is callable with auth:check shape', () => {
    const { events, cleanup } = collectEvents('auth:check')
    emit('auth:check', {
      userId: 'user-1',
      allowed: true,
      isBotAdmin: true,
      isGroupAdmin: false,
      storageContextId: 'user-1',
    })
    expect(events).toHaveLength(1)
    expect(events[0]!.data['allowed']).toBe(true)
    cleanup()
  })

  test('emit is callable with message:replied shape', () => {
    const { events, cleanup } = collectEvents('message:replied')
    emit('message:replied', {
      userId: 'user-1',
      contextId: 'ctx-1',
      duration: 1500,
    })
    expect(events).toHaveLength(1)
    expect(events[0]!.data['duration']).toBe(1500)
    cleanup()
  })
})
```

**Step 2: Run test to verify it passes (events shapes are valid)**

Run: `bun test tests/debug/instrumentation.test.ts`
Expected: PASS (these test the event shapes, not the actual wiring)

**Step 3: Add emit calls to `src/bot.ts`**

Add import at top:

```typescript
import { emit } from './debug/event-bus.js'
```

Modify `chat.onMessage` callback (lines 202-235):

```typescript
chat.onMessage(async (msg, reply) => {
  emit('message:received', {
    userId: msg.user.id,
    contextId: msg.contextId,
    contextType: msg.contextType,
    textLength: msg.text.length,
    isCommand: msg.text.startsWith('/'),
  })

  // Get authorization FIRST (needed for wizard storage context)
  const auth = checkAuthorizationExtended(
    msg.user.id,
    msg.user.username,
    msg.contextId,
    msg.contextType,
    msg.user.isAdmin,
  )

  emit('auth:check', {
    userId: msg.user.id,
    allowed: auth.allowed,
    isBotAdmin: auth.isBotAdmin,
    isGroupAdmin: auth.isGroupAdmin,
    storageContextId: auth.storageContextId,
  })

  // ... wizard interception unchanged ...

  const start = Date.now()
  try {
    await handleMessage(msg, reply, auth)
  } finally {
    emit('message:replied', {
      userId: msg.user.id,
      contextId: msg.contextId,
      duration: Date.now() - start,
    })
  }
})
```

**Step 4: Run tests**

Run: `bun test tests/debug/instrumentation.test.ts && bun test`
Expected: All pass

**Step 5: Commit**

```bash
git add src/bot.ts tests/debug/instrumentation.test.ts
git commit -m "feat(debug): instrument bot.ts with message lifecycle events"
```

---

### Task 10: Instrument `llm-orchestrator.ts` — SDK callbacks + error emit

**Files:**

- Modify: `src/llm-orchestrator.ts:1,117-123,193`
- Modify: `tests/debug/instrumentation.test.ts`

**Step 1: Write the failing test**

Add to `tests/debug/instrumentation.test.ts`:

```typescript
describe('llm-orchestrator.ts instrumentation', () => {
  test('emit is callable with llm:start shape', () => {
    const { events, cleanup } = collectEvents('llm:start')
    emit('llm:start', { userId: 'ctx-1', model: 'gpt-4o', messageCount: 5, toolCount: 10 })
    expect(events).toHaveLength(1)
    expect(events[0]!.data['model']).toBe('gpt-4o')
    cleanup()
  })

  test('emit is callable with llm:tool_call shape', () => {
    const { events, cleanup } = collectEvents('llm:tool_call')
    emit('llm:tool_call', { userId: 'ctx-1', toolName: 'search_tasks', toolCallId: 'tc-1', args: { query: 'test' } })
    expect(events).toHaveLength(1)
    expect(events[0]!.data['toolName']).toBe('search_tasks')
    cleanup()
  })

  test('emit is callable with llm:tool_result shape', () => {
    const { events, cleanup } = collectEvents('llm:tool_result')
    emit('llm:tool_result', {
      userId: 'ctx-1',
      toolName: 'search_tasks',
      toolCallId: 'tc-1',
      durationMs: 250,
      success: true,
    })
    expect(events).toHaveLength(1)
    expect(events[0]!.data['durationMs']).toBe(250)
    expect(events[0]!.data['success']).toBe(true)
    cleanup()
  })

  test('emit is callable with llm:end shape', () => {
    const { events, cleanup } = collectEvents('llm:end')
    emit('llm:end', {
      userId: 'ctx-1',
      model: 'gpt-4o',
      steps: 3,
      totalDuration: 2500,
      tokenUsage: { inputTokens: 1200, outputTokens: 340 },
    })
    expect(events).toHaveLength(1)
    expect(events[0]!.data['steps']).toBe(3)
    cleanup()
  })

  test('emit is callable with llm:error shape', () => {
    const { events, cleanup } = collectEvents('llm:error')
    emit('llm:error', { userId: 'ctx-1', error: 'API timeout', model: 'gpt-4o' })
    expect(events).toHaveLength(1)
    expect(events[0]!.data['error']).toBe('API timeout')
    cleanup()
  })
})
```

**Step 2: Run test to verify it passes**

Run: `bun test tests/debug/instrumentation.test.ts`
Expected: PASS

**Step 3: Add emit calls to `src/llm-orchestrator.ts`**

Add import at top:

```typescript
import { emit } from './debug/event-bus.js'
```

Modify `callLlm` function — add `start` timer and SDK callbacks to `generateText()`, and emit `llm:end` after:

```typescript
const start = Date.now()
emit('llm:start', {
  userId: contextId,
  model: mainModel,
  messageCount: messagesWithMemory.length,
  toolCount: Object.keys(tools).length,
})
const result = await generateText({
  model,
  system: buildSystemPrompt(provider, timezone, contextId),
  messages: messagesWithMemory,
  tools,
  stopWhen: stepCountIs(25),
  experimental_onToolCallStart(event) {
    emit('llm:tool_call', {
      userId: contextId,
      toolName: event.toolName,
      toolCallId: event.toolCallId,
      args: event.input,
    })
  },
  experimental_onToolCallFinish(event) {
    emit('llm:tool_result', {
      userId: contextId,
      toolName: event.toolCall.toolName,
      toolCallId: event.toolCall.toolCallId,
      durationMs: event.durationMs,
      success: event.success,
      ...(event.success ? {} : { error: String(event.error) }),
    })
  },
})
emit('llm:end', {
  userId: contextId,
  model: mainModel,
  steps: result.steps.length,
  totalDuration: Date.now() - start,
  tokenUsage: result.usage,
})
```

In `processMessage` catch block (line 193), add `llm:error` emit:

```typescript
  } catch (error) {
    emit('llm:error', {
      userId: contextId,
      error: error instanceof Error ? error.message : String(error),
      model: getConfig(contextId, 'main_model') ?? 'unknown',
    })
    saveHistory(contextId, baseHistory)
    await handleMessageError(reply, contextId, error)
  }
```

**Step 4: Run tests**

Run: `bun test tests/debug/instrumentation.test.ts && bun test`
Expected: All pass

**Step 5: Commit**

```bash
git add src/llm-orchestrator.ts tests/debug/instrumentation.test.ts
git commit -m "feat(debug): instrument llm-orchestrator with SDK callbacks and error emit"
```

---

### Task 11: Instrument `cache.ts` — 15 emit points

**Files:**

- Modify: `src/cache.ts` (already has `emit` import path from event-bus)
- Modify: `tests/debug/instrumentation.test.ts`

**Step 1: Write the failing test**

Add to `tests/debug/instrumentation.test.ts`:

```typescript
describe('cache.ts instrumentation', () => {
  test('emit is callable with cache:load shape', () => {
    const { events, cleanup } = collectEvents('cache:load')
    emit('cache:load', { userId: 'user-1', field: 'history' })
    expect(events).toHaveLength(1)
    expect(events[0]!.data['field']).toBe('history')
    cleanup()
  })

  test('emit is callable with cache:sync shape', () => {
    const { events, cleanup } = collectEvents('cache:sync')
    emit('cache:sync', { userId: 'user-1', field: 'history', operation: 'set' })
    expect(events).toHaveLength(1)
    expect(events[0]!.data['operation']).toBe('set')
    cleanup()
  })

  test('emit is callable with cache:expire shape', () => {
    const { events, cleanup } = collectEvents('cache:expire')
    emit('cache:expire', { userId: 'user-1' })
    expect(events).toHaveLength(1)
    cleanup()
  })
})
```

**Step 2: Run test — PASS (shape validation only)**

**Step 3: Add emit calls to `src/cache.ts`**

Add import:

```typescript
import { emit } from './debug/event-bus.js'
```

Add `emit('cache:load', ...)` inside each cache-miss branch:

- `getCachedHistory` (line 84): `emit('cache:load', { userId, field: 'history' })`
- `getCachedSummary` (line 118): `emit('cache:load', { userId, field: 'summary' })`
- `getCachedFacts` (line 143): `emit('cache:load', { userId, field: 'facts' })`
- `getCachedConfig` (line 181): `emit('cache:load', { userId, field: 'config' })`
- `getCachedWorkspace` (line 203): `emit('cache:load', { userId, field: 'workspace' })`
- `getCachedInstructions` (line 262): `emit('cache:load', { userId: contextId, field: 'instructions' })`

Add `emit('cache:sync', ...)` after each mutation:

- `setCachedHistory` (line 104): `emit('cache:sync', { userId, field: 'history', operation: 'set' })`
- `appendToCachedHistory` (line 110): `emit('cache:sync', { userId, field: 'history', operation: 'append' })`
- `setCachedSummary` (line 133): `emit('cache:sync', { userId, field: 'summary', operation: 'set' })`
- `upsertCachedFact` (line 173): `emit('cache:sync', { userId, field: 'facts', operation: 'upsert' })`
- `setCachedConfig` (line 195): `emit('cache:sync', { userId, field: 'config', operation: 'set' })`
- `setCachedWorkspace` (line 218): `emit('cache:sync', { userId, field: 'workspace', operation: 'set' })`
- `addCachedInstruction` (line 279): `emit('cache:sync', { userId: contextId, field: 'instructions', operation: 'set' })`
- `deleteCachedInstruction` (line 287): `emit('cache:sync', { userId: contextId, field: 'instructions', operation: 'delete' })`

Add `emit('cache:expire', ...)` in `cleanupExpiredCaches` (line 52):

```typescript
for (const userId of expired) {
  userCaches.delete(userId)
  emit('cache:expire', { userId })
  log.debug({ userId }, 'Expired user cache removed')
}
```

**Step 4: Run tests**

Run: `bun test`
Expected: All pass

**Step 5: Commit**

```bash
git add src/cache.ts tests/debug/instrumentation.test.ts
git commit -m "feat(debug): instrument cache.ts with load/sync/expire events"
```

---

### Task 12: Instrument `conversation.ts` — 2 emit points

**Files:**

- Modify: `src/conversation.ts:34-65`

**Step 1: Add emit calls to `src/conversation.ts`**

Add import:

```typescript
import { emit } from './debug/event-bus.js'
```

In `runTrimInBackground`, add `trim:start` after the reason computation (line 38):

```typescript
emit('trim:start', { userId, historyLength: history.length, reason })
```

Add `trim:end` in the success path (after line 55):

```typescript
log.info({ userId, retained: trimmedMessages.length, preserved: newMessages.length }, 'Smart trim complete')
emit('trim:end', {
  userId,
  kept: trimmedMessages.length,
  dropped: history.length - trimmedMessages.length,
  success: true,
})
```

Add `trim:end` in the catch block (after line 59):

```typescript
      log.warn(...)
      emit('trim:end', { userId, error: error instanceof Error ? error.message : String(error), success: false })
```

**Step 2: Run tests**

Run: `bun test`
Expected: All pass

**Step 3: Commit**

```bash
git add src/conversation.ts
git commit -m "feat(debug): instrument conversation.ts with trim events"
```

---

### Task 13: Instrument `wizard/state.ts` — 3 emit points

**Files:**

- Modify: `src/wizard/state.ts:64,126,141`

**Step 1: Add emit calls**

Add import:

```typescript
import { emit } from '../debug/event-bus.js'
```

After `activeSessions.set(key, session)` (line 64):

```typescript
emit('wizard:created', { userId, storageContextId, totalSteps, platform, taskProvider })
```

After the wizard update logging (line 129):

```typescript
emit('wizard:updated', { userId, storageContextId, currentStep: session.currentStep })
```

After `activeSessions.delete(key)` (line 141):

```typescript
emit('wizard:deleted', { userId, storageContextId })
```

**Step 2: Run tests**

Run: `bun test`
Expected: All pass

**Step 3: Commit**

```bash
git add src/wizard/state.ts
git commit -m "feat(debug): instrument wizard/state.ts with session lifecycle events"
```

---

### Task 14: Instrument `scheduler.ts` — 2 emit points

**Files:**

- Modify: `src/scheduler.ts:196,125`

**Step 1: Add emit calls**

Add import:

```typescript
import { emit } from './debug/event-bus.js'
```

After `tickCount++` (line 196):

```typescript
emit('scheduler:tick', { tickCount, dueTaskCount: dueTasks.length })
```

After successful task creation log (line 128):

```typescript
emit('scheduler:task_executed', { userId: task.userId, recurringTaskId: task.id, createdTaskId: created.id })
```

**Step 2: Run tests**

Run: `bun test`
Expected: All pass

**Step 3: Commit**

```bash
git add src/scheduler.ts
git commit -m "feat(debug): instrument scheduler.ts with tick and task execution events"
```

---

### Task 15: Instrument `deferred-prompts/poller.ts` — 2 emit points

**Files:**

- Modify: `src/deferred-prompts/poller.ts:123,222`

**Step 1: Add emit calls**

Add import:

```typescript
import { emit } from '../debug/event-bus.js'
```

In `pollScheduledOnce`, after `duePrompts` query (line 123):

```typescript
emit('poller:scheduled', { dueCount: duePrompts.length })
```

In `pollAlertsOnce`, after `eligibleAlerts` query (line 222):

```typescript
emit('poller:alerts', { eligibleCount: eligibleAlerts.length })
```

**Step 2: Run tests**

Run: `bun test`
Expected: All pass

**Step 3: Commit**

```bash
git add src/deferred-prompts/poller.ts
git commit -m "feat(debug): instrument poller.ts with scheduled/alerts events"
```

---

### Task 16: Instrument `message-cache/cache.ts` — 1 emit point

**Files:**

- Modify: `src/message-cache/cache.ts:24`

**Step 1: Add emit call**

Add import:

```typescript
import { emit } from '../debug/event-bus.js'
```

In the daily sweep `setInterval`, after the deletion loop (line 24):

```typescript
if (swept > 0) {
  emit('msgcache:sweep', { swept, remaining: messageCache.size })
  log.info({ swept, remaining: messageCache.size }, 'Swept expired message cache entries')
}
```

**Step 2: Run tests**

Run: `bun test`
Expected: All pass

**Step 3: Commit**

```bash
git add src/message-cache/cache.ts
git commit -m "feat(debug): instrument message-cache with sweep event"
```

---

### Task 17: Final verification — full suite + lint + typecheck

**Step 1: Run full test suite**

Run: `bun test`
Expected: All pass

**Step 2: Run lint**

Run: `bun lint`
Expected: No new errors

**Step 3: Run typecheck**

Run: `bun typecheck`
Expected: No errors

**Step 4: Run format check**

Run: `bun format:check`
Expected: No issues (or run `bun format` to fix)

**Step 5: Run mock-pollution check**

Run: `bun run mock-pollution`
Expected: No new pollution detected

**Step 6: Run knip**

Run: `bun knip`
Expected: No unused exports (all new exports are consumed by state-collector or tests)
