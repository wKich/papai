# Debug Session 1: Event Bus + Server Skeleton — Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Create the foundation layer for the debug tracing tool: event bus, SSE-capable HTTP server via `Bun.serve()`, and state collector stub.

**Architecture:** Minimal function-based event bus (`Set<Listener>`) emits events synchronously. State collector manages SSE client connections and bridges the bus to HTTP. `Bun.serve()` serves two routes (`/events` SSE, `/dashboard` placeholder). Everything gated behind `DEBUG_SERVER=true` env var with zero overhead when disabled.

**Tech Stack:** Bun runtime (built-in `Bun.serve()`), web `ReadableStream` API, `TextEncoder`, pino logger. Zero new dependencies.

**Design doc:** `docs/plans/2026-03-28-debug-session1-event-bus-server-skeleton.md`

---

### Task 1: Event Bus — Tests

**Files:**

- Create: `tests/debug/event-bus.test.ts`

**Step 1: Write the test file**

```typescript
import { afterEach, describe, expect, mock, test } from 'bun:test'

import { emit, subscribe, unsubscribe, type DebugEvent } from '../../src/debug/event-bus.js'

describe('event-bus', () => {
  const listeners: Array<(event: DebugEvent) => void> = []

  afterEach(() => {
    for (const fn of listeners) unsubscribe(fn)
    listeners.length = 0
  })

  const track = (fn: (event: DebugEvent) => void): typeof fn => {
    listeners.push(fn)
    return fn
  }

  test('emit with no listeners is a no-op', () => {
    expect(() => emit('test', { key: 'value' })).not.toThrow()
  })

  test('subscribe + emit delivers event to listener', () => {
    const listener = mock(() => {})
    subscribe(track(listener))

    emit('test:event', { foo: 'bar' })

    expect(listener).toHaveBeenCalledTimes(1)
    const event = listener.mock.calls[0]![0] as DebugEvent
    expect(event.type).toBe('test:event')
    expect(event.data).toEqual({ foo: 'bar' })
  })

  test('event has correct shape with auto-populated timestamp', () => {
    let captured: DebugEvent | null = null
    subscribe(
      track((e) => {
        captured = e
      }),
    )

    const before = Date.now()
    emit('shape:test', { x: 1 })
    const after = Date.now()

    expect(captured).not.toBeNull()
    expect(captured!.type).toBe('shape:test')
    expect(captured!.timestamp).toBeGreaterThanOrEqual(before)
    expect(captured!.timestamp).toBeLessThanOrEqual(after)
    expect(captured!.data).toEqual({ x: 1 })
  })

  test('multiple listeners all receive the event', () => {
    const listener1 = mock(() => {})
    const listener2 = mock(() => {})
    subscribe(track(listener1))
    subscribe(track(listener2))

    emit('multi', {})

    expect(listener1).toHaveBeenCalledTimes(1)
    expect(listener2).toHaveBeenCalledTimes(1)
  })

  test('unsubscribe stops delivery', () => {
    const listener = mock(() => {})
    subscribe(listener)

    emit('before', {})
    expect(listener).toHaveBeenCalledTimes(1)

    unsubscribe(listener)
    emit('after', {})
    expect(listener).toHaveBeenCalledTimes(1)
  })
})
```

**Step 2: Run test to verify it fails**

Run: `bun test tests/debug/event-bus.test.ts`

Expected: FAIL — module `../../src/debug/event-bus.js` not found.

**Step 3: Commit**

```bash
git add tests/debug/event-bus.test.ts
git commit -m "test(debug): add event bus unit tests (red)"
```

---

### Task 2: Event Bus — Implementation

**Files:**

- Create: `src/debug/event-bus.ts`

**Step 1: Write the implementation**

```typescript
export type DebugEvent = {
  type: string
  timestamp: number
  data: Record<string, unknown>
}

type Listener = (event: DebugEvent) => void

const listeners = new Set<Listener>()

/** @public -- consumed by source modules in Session 3 */
export function emit(type: string, data: Record<string, unknown>): void {
  if (listeners.size === 0) return
  const event: DebugEvent = { type, timestamp: Date.now(), data }
  for (const fn of listeners) fn(event)
}

export function subscribe(fn: Listener): void {
  listeners.add(fn)
}

export function unsubscribe(fn: Listener): void {
  listeners.delete(fn)
}
```

**Step 2: Run test to verify it passes**

Run: `bun test tests/debug/event-bus.test.ts`

Expected: 5 tests pass.

**Step 3: Commit**

```bash
git add src/debug/event-bus.ts
git commit -m "feat(debug): add event bus with zero-overhead guard"
```

---

### Task 3: State Collector — Tests

**Files:**

- Create: `tests/debug/state-collector.test.ts`

**Context:** The state collector imports from `event-bus.ts` (which exists now). Tests use mock `ReadableStreamDefaultController` objects — no shared module mocking needed.

**Step 1: Write the test file**

```typescript
import { afterEach, describe, expect, mock, test } from 'bun:test'

import { emit, subscribe, unsubscribe } from '../../src/debug/event-bus.js'
import { addClient, removeClient } from '../../src/debug/state-collector.js'

const createMockController = (): ReadableStreamDefaultController => {
  const enqueue = mock(() => {})
  return { enqueue, close: mock(() => {}), desiredSize: 1 } as unknown as ReadableStreamDefaultController
}

const parseSsePayload = (call: unknown[]): { event: string; data: unknown } => {
  const raw = call[0] as Uint8Array
  const text = new TextDecoder().decode(raw)
  const eventMatch = text.match(/^event: (.+)$/m)
  const dataMatch = text.match(/^data: (.+)$/m)
  return {
    event: eventMatch?.[1] ?? '',
    data: JSON.parse(dataMatch?.[1] ?? '{}') as unknown,
  }
}

describe('state-collector', () => {
  const controllers: ReadableStreamDefaultController[] = []

  afterEach(() => {
    for (const ctrl of controllers) removeClient(ctrl)
    controllers.length = 0
  })

  const track = (ctrl: ReadableStreamDefaultController): ReadableStreamDefaultController => {
    controllers.push(ctrl)
    return ctrl
  }

  test('addClient sends state:init immediately', () => {
    const ctrl = createMockController()
    addClient(track(ctrl))

    const enqueue = ctrl.enqueue as ReturnType<typeof mock>
    expect(enqueue).toHaveBeenCalledTimes(1)

    const { event, data } = parseSsePayload(enqueue.mock.calls[0]!)
    expect(event).toBe('state:init')
    expect((data as { type: string }).type).toBe('state:init')
  })

  test('events broadcast to all connected clients', () => {
    const ctrl1 = createMockController()
    const ctrl2 = createMockController()
    addClient(track(ctrl1))
    addClient(track(ctrl2))

    emit('test:broadcast', { value: 42 })

    const enqueue1 = ctrl1.enqueue as ReturnType<typeof mock>
    const enqueue2 = ctrl2.enqueue as ReturnType<typeof mock>
    // 1 for state:init + 1 for broadcast
    expect(enqueue1).toHaveBeenCalledTimes(2)
    expect(enqueue2).toHaveBeenCalledTimes(2)

    const { event } = parseSsePayload(enqueue1.mock.calls[1]!)
    expect(event).toBe('test:broadcast')
  })

  test('removeClient stops delivery to that client', () => {
    const ctrl = createMockController()
    addClient(ctrl)
    removeClient(ctrl)

    emit('after:remove', {})

    const enqueue = ctrl.enqueue as ReturnType<typeof mock>
    // Only the state:init call, no broadcast
    expect(enqueue).toHaveBeenCalledTimes(1)
  })

  test('dead client (enqueue throws) is removed silently', () => {
    const ctrl = createMockController()
    const goodCtrl = createMockController()
    addClient(track(ctrl))
    addClient(track(goodCtrl))

    // Make ctrl throw on next enqueue
    ;(ctrl.enqueue as ReturnType<typeof mock>).mockImplementation(() => {
      throw new Error('stream closed')
    })

    expect(() => emit('error:test', {})).not.toThrow()

    // Good client still receives events
    ;(ctrl.enqueue as ReturnType<typeof mock>).mockImplementation(mock(() => {}))
    emit('after:error', {})

    const goodEnqueue = goodCtrl.enqueue as ReturnType<typeof mock>
    // state:init + error:test + after:error = 3
    expect(goodEnqueue).toHaveBeenCalledTimes(3)
  })
})
```

**Step 2: Run test to verify it fails**

Run: `bun test tests/debug/state-collector.test.ts`

Expected: FAIL — module `../../src/debug/state-collector.js` not found.

**Step 3: Commit**

```bash
git add tests/debug/state-collector.test.ts
git commit -m "test(debug): add state collector unit tests (red)"
```

---

### Task 4: State Collector — Implementation

**Files:**

- Create: `src/debug/state-collector.ts`

**Step 1: Write the implementation**

```typescript
import { subscribe, unsubscribe, type DebugEvent } from './event-bus.js'

const clients = new Set<ReadableStreamDefaultController>()
const encoder = new TextEncoder()

/** @public -- called by server.ts on new SSE connection */
export function addClient(controller: ReadableStreamDefaultController): void {
  clients.add(controller)

  sendTo(controller, { type: 'state:init', timestamp: Date.now(), data: {} })

  if (clients.size === 1) {
    subscribe(onEvent)
  }
}

/** @public -- called by server.ts on SSE disconnect */
export function removeClient(controller: ReadableStreamDefaultController): void {
  clients.delete(controller)

  if (clients.size === 0) {
    unsubscribe(onEvent)
  }
}

function onEvent(event: DebugEvent): void {
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

**Step 2: Run test to verify it passes**

Run: `bun test tests/debug/state-collector.test.ts`

Expected: 4 tests pass.

**Step 3: Run event bus tests too (no regression)**

Run: `bun test tests/debug/`

Expected: 9 tests pass (5 event-bus + 4 state-collector).

**Step 4: Commit**

```bash
git add src/debug/state-collector.ts
git commit -m "feat(debug): add state collector with lazy bus subscription"
```

---

### Task 5: Debug Server — Tests

**Files:**

- Create: `tests/debug/server.test.ts`

**Context:** These are integration tests using real HTTP requests to localhost. The server imports from `state-collector.ts` and `logger.ts`. No module mocking needed — `src/debug/` is self-contained. Use a unique port to avoid conflicts with other tests or the bot.

**Step 1: Write the test file**

```typescript
import { afterAll, beforeAll, describe, expect, test } from 'bun:test'

import { startDebugServer, stopDebugServer } from '../../src/debug/server.js'

const TEST_PORT = 19100

describe('debug-server', () => {
  beforeAll(() => {
    process.env['DEBUG_PORT'] = String(TEST_PORT)
    startDebugServer()
  })

  afterAll(() => {
    stopDebugServer()
    delete process.env['DEBUG_PORT']
  })

  test('GET /dashboard returns HTML', async () => {
    const res = await fetch(`http://localhost:${TEST_PORT}/dashboard`)
    expect(res.status).toBe(200)
    expect(res.headers.get('content-type')).toBe('text/html')
    const body = await res.text()
    expect(body).toContain('papai debug dashboard')
  })

  test('GET /events returns SSE headers', async () => {
    const res = await fetch(`http://localhost:${TEST_PORT}/events`)
    expect(res.status).toBe(200)
    expect(res.headers.get('content-type')).toBe('text/event-stream')
    expect(res.headers.get('cache-control')).toBe('no-cache')
    // Abort the stream to clean up
    await res.body?.cancel()
  })

  test('unknown route returns 404', async () => {
    const res = await fetch(`http://localhost:${TEST_PORT}/nonexistent`)
    expect(res.status).toBe(404)
    await res.body?.cancel()
  })

  test('SSE client receives state:init on connect', async () => {
    const res = await fetch(`http://localhost:${TEST_PORT}/events`)
    const reader = res.body!.getReader()
    const decoder = new TextDecoder()

    const { value } = await reader.read()
    const text = decoder.decode(value)

    expect(text).toContain('event: state:init')
    expect(text).toContain('"type":"state:init"')

    await reader.cancel()
  })
})
```

**Step 2: Run test to verify it fails**

Run: `bun test tests/debug/server.test.ts`

Expected: FAIL — `startDebugServer` not exported from `../../src/debug/server.js` (module not found).

**Step 3: Commit**

```bash
git add tests/debug/server.test.ts
git commit -m "test(debug): add server integration tests (red)"
```

---

### Task 6: Debug Server — Implementation

**Files:**

- Create: `src/debug/server.ts`

**Step 1: Write the implementation**

```typescript
import { logger } from '../logger.js'
import { addClient, removeClient } from './state-collector.js'

const log = logger.child({ scope: 'debug-server' })

const DEFAULT_PORT = 9100

function getPort(): number {
  const env = process.env['DEBUG_PORT']
  if (env !== undefined && env !== '') {
    const parsed = Number.parseInt(env, 10)
    if (!Number.isNaN(parsed) && parsed > 0 && parsed < 65536) return parsed
  }
  return DEFAULT_PORT
}

let server: ReturnType<typeof Bun.serve> | null = null

export function startDebugServer(): void {
  const port = getPort()

  server = Bun.serve({
    port,
    idleTimeout: 0,
    fetch(req) {
      const url = new URL(req.url)

      if (url.pathname === '/events') {
        let ctrl: ReadableStreamDefaultController
        const stream = new ReadableStream({
          start(controller) {
            ctrl = controller
            addClient(controller)
            req.signal.addEventListener('abort', () => removeClient(controller))
          },
          cancel() {
            removeClient(ctrl)
          },
        })
        return new Response(stream, {
          headers: {
            'Content-Type': 'text/event-stream',
            'Cache-Control': 'no-cache',
            Connection: 'keep-alive',
          },
        })
      }

      if (url.pathname === '/dashboard') {
        return new Response('<html><body><h1>papai debug dashboard</h1><p>Coming in Session 4</p></body></html>', {
          headers: { 'Content-Type': 'text/html' },
        })
      }

      return new Response('Not found', { status: 404 })
    },
  })

  log.info({ port }, 'Debug server started')
}

export function stopDebugServer(): void {
  if (server !== null) {
    server.stop()
    server = null
    log.info('Debug server stopped')
  }
}
```

**Step 2: Run test to verify it passes**

Run: `bun test tests/debug/server.test.ts`

Expected: 4 tests pass.

**Step 3: Run all debug tests (no regression)**

Run: `bun test tests/debug/`

Expected: 13 tests pass (5 event-bus + 4 state-collector + 4 server).

**Step 4: Commit**

```bash
git add src/debug/server.ts
git commit -m "feat(debug): add Bun.serve() debug server with SSE and dashboard"
```

---

### Task 7: Wire into index.ts + package.json

**Files:**

- Modify: `src/index.ts:86-106` (add debug server startup + shutdown hook)
- Modify: `package.json:9` (add `start:debug` script)

**Step 1: Add `start:debug` script to `package.json`**

In `package.json`, add after the `"start"` line:

```json
"start:debug": "DEBUG_SERVER=true bun run src/index.ts",
```

**Step 2: Add debug server startup and shutdown to `src/index.ts`**

After line 86 (`startMessageCleanupScheduler()`), add:

```typescript
let stopDebugServerFn: (() => void) | null = null

if (process.env['DEBUG_SERVER'] === 'true') {
  const { startDebugServer, stopDebugServer } = await import('./debug/server.js')
  startDebugServer()
  stopDebugServerFn = stopDebugServer
}
```

In both `SIGINT` and `SIGTERM` handlers, add `stopDebugServerFn?.()` before `void chatProvider.stop()`:

```typescript
process.on('SIGINT', () => {
  log.info('SIGINT received, shutting down gracefully')
  stopScheduler()
  stopPollers()
  stopDebugServerFn?.()
  void chatProvider.stop()
  closeDrizzleDb()
  closeMigrationDbInstance()
  process.exit(0)
})

process.on('SIGTERM', () => {
  log.info('SIGTERM received, shutting down gracefully')
  stopScheduler()
  stopPollers()
  stopDebugServerFn?.()
  void chatProvider.stop()
  closeDrizzleDb()
  closeMigrationDbInstance()
  process.exit(0)
})
```

**Step 3: Commit**

```bash
git add src/index.ts package.json
git commit -m "feat(debug): wire debug server into startup and shutdown"
```

---

### Task 8: Add tests/debug to test script + run full checks

**Files:**

- Modify: `package.json:18` (add `tests/debug` to test script)

**Step 1: Update the test script**

The current test script is:

```json
"test": "bun test tests/providers tests/tools tests/scripts tests/db tests/utils tests/schemas tests/proactive tests/*.test.ts"
```

Add `tests/debug` to the list:

```json
"test": "bun test tests/providers tests/tools tests/scripts tests/db tests/utils tests/schemas tests/proactive tests/debug tests/*.test.ts"
```

**Step 2: Format all new files**

Run: `bun format`

**Step 3: Run full checks**

Run: `bun check:verbose`

Expected: All checks pass — lint, typecheck, format, knip, tests, duplicates, mock-pollution.

**Troubleshooting:**

- **knip reports unused exports**: Verify `/** @public */` tags are on `emit`, `subscribe` (event-bus) and `addClient`, `removeClient` (state-collector). Knip respects `@public` JSDoc tags.
- **typecheck fails on `ReadableStreamDefaultController`**: This type is available globally in Bun (included in `@types/bun`). No import needed.
- **lint errors**: Run `bun lint:fix` to auto-fix, then re-check.

**Step 4: Commit**

```bash
git add package.json
git commit -m "chore: add tests/debug to test script"
```

If formatting changed any files:

```bash
git add -u
git commit -m "style: format debug module files"
```

---

### Verification Checklist

After all tasks are complete, verify the acceptance criteria manually:

1. **Zero overhead when disabled**: `bun start` — bot starts normally, no debug server port opened, no `src/debug/` loaded
2. **Debug server starts**: `DEBUG_SERVER=true bun start` — look for `Debug server started` in logs with port 9100
3. **SSE works**: `curl -N http://localhost:9100/events` — should print `event: state:init` then hang (waiting for events)
4. **Dashboard placeholder**: `curl http://localhost:9100/dashboard` — returns HTML with "papai debug dashboard"
5. **Custom port**: `DEBUG_SERVER=true DEBUG_PORT=9200 bun start` — server starts on 9200
6. **All checks green**: `bun check:verbose` — all pass
