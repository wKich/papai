# Debug Session 2: Pino Log Pipeline — Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Connect pino's log output to an in-memory ring buffer with search/filter REST endpoints, enabling the debug dashboard (Session 4) to query and tail logs.

**Architecture:** `logger.ts` always creates `pino.multistream([stdout])`. When `DEBUG_SERVER=true`, `startDebugServer()` dynamically attaches a ring buffer stream via `.add()`. The ring buffer stores parsed pino JSON objects and exposes `GET /logs` (search) and `GET /logs/stats` (metadata) on the existing `Bun.serve()`. Each log entry also emits a `log:entry` event on the SSE bus for live tailing.

**Tech Stack:** pino multistream (built-in, no new deps), Bun runtime, existing event bus from Session 1. Zero new dependencies.

**Design doc:** `docs/plans/2026-03-28-session2-pino-log-pipeline-design.md`

---

### Task 1: Logger Multistream

**Files:**

- Modify: `src/logger.ts`

**Context:** Currently `logger.ts` creates `pino(opts)` which writes to stdout via pino's default SonicBoom destination. We switch to `pino(opts, pino.multistream([stdout]))` so that `startDebugServer()` can later call `.add()` to attach the ring buffer stream.

**Step 1: Modify `src/logger.ts`**

Replace the entire file with:

```typescript
import pino from 'pino'

export const getLogLevel = (): string => {
  const envLevel = process.env['LOG_LEVEL']?.toLowerCase()
  const validLevels = ['trace', 'debug', 'info', 'warn', 'error', 'fatal', 'silent']
  if (envLevel !== undefined && envLevel !== '' && validLevels.includes(envLevel)) {
    return envLevel
  }
  return 'info'
}

/** @public -- debug server calls .add() to attach the log buffer stream */
export const logMultistream = pino.multistream([{ stream: process.stdout }])

export const logger = pino(
  {
    level: getLogLevel(),
    timestamp: pino.stdTimeFunctions.isoTime,
    base: undefined,
  },
  logMultistream,
)
```

Changes from original:

- Added `logMultistream` const wrapping `process.stdout`
- Passed `logMultistream` as second argument to `pino()`
- Added `@public` JSDoc tag for knip (used via dynamic import in `src/debug/server.ts`)

**Step 2: Run existing debug tests to verify no regression**

Run: `bun test tests/debug/`

Expected: 13 tests pass (5 event-bus + 4 state-collector + 4 server). Logger output is functionally identical.

**Step 3: Commit**

```bash
git add src/logger.ts
git commit -m "refactor(debug): switch logger to pino.multistream for dynamic stream attachment"
```

---

### Task 2: Log Buffer — Tests

**Files:**

- Create: `tests/debug/log-buffer.test.ts`

**Context:** Tests the `LogRingBuffer` class directly with small capacity (3-10 entries) for wrap-around verification. Also tests the stream adapter and SSE emission. Imports from `event-bus.ts` (exists from Session 1) — no module mocking needed.

**Step 1: Write the test file**

```typescript
import { afterEach, describe, expect, mock, test } from 'bun:test'

import { subscribe, unsubscribe, type DebugEvent } from '../../src/debug/event-bus.js'
import { logBuffer, logBufferStream, LogRingBuffer, type LogEntry } from '../../src/debug/log-buffer.js'

const makeEntry = (overrides: Partial<LogEntry> = {}): LogEntry => ({
  level: 30,
  time: new Date().toISOString(),
  msg: 'test message',
  ...overrides,
})

describe('LogRingBuffer', () => {
  test('push and retrieve single entry', () => {
    const buf = new LogRingBuffer(10)
    const entry = makeEntry()
    buf.push(entry)

    expect(buf.entries()).toHaveLength(1)
    expect(buf.entries()[0]).toEqual(entry)
  })

  test('entries returns chronological order', () => {
    const buf = new LogRingBuffer(10)
    const e1 = makeEntry({ msg: 'first' })
    const e2 = makeEntry({ msg: 'second' })
    buf.push(e1)
    buf.push(e2)

    const all = buf.entries()
    expect(all[0]!.msg).toBe('first')
    expect(all[1]!.msg).toBe('second')
  })

  test('wraps around when capacity exceeded', () => {
    const buf = new LogRingBuffer(3)
    buf.push(makeEntry({ msg: 'a' }))
    buf.push(makeEntry({ msg: 'b' }))
    buf.push(makeEntry({ msg: 'c' }))
    buf.push(makeEntry({ msg: 'd' }))

    const all = buf.entries()
    expect(all).toHaveLength(3)
    expect(all[0]!.msg).toBe('b')
    expect(all[1]!.msg).toBe('c')
    expect(all[2]!.msg).toBe('d')
  })

  test('wraps around multiple times', () => {
    const buf = new LogRingBuffer(3)
    for (let i = 0; i < 10; i++) {
      buf.push(makeEntry({ msg: `msg-${i}` }))
    }

    const all = buf.entries()
    expect(all).toHaveLength(3)
    expect(all[0]!.msg).toBe('msg-7')
    expect(all[1]!.msg).toBe('msg-8')
    expect(all[2]!.msg).toBe('msg-9')
  })

  test('clear resets buffer', () => {
    const buf = new LogRingBuffer(10)
    buf.push(makeEntry())
    buf.push(makeEntry())
    buf.clear()

    expect(buf.entries()).toHaveLength(0)
    expect(buf.stats().count).toBe(0)
  })
})

describe('search', () => {
  test('filters by minimum level', () => {
    const buf = new LogRingBuffer(10)
    buf.push(makeEntry({ level: 20, msg: 'debug' }))
    buf.push(makeEntry({ level: 30, msg: 'info' }))
    buf.push(makeEntry({ level: 50, msg: 'error' }))

    const results = buf.search({ level: 30 })
    expect(results).toHaveLength(2)
    expect(results[0]!.msg).toBe('info')
    expect(results[1]!.msg).toBe('error')
  })

  test('filters by exact scope', () => {
    const buf = new LogRingBuffer(10)
    buf.push(makeEntry({ scope: 'bot', msg: 'bot msg' }))
    buf.push(makeEntry({ scope: 'llm-orch', msg: 'llm msg' }))

    const results = buf.search({ scope: 'llm-orch' })
    expect(results).toHaveLength(1)
    expect(results[0]!.msg).toBe('llm msg')
  })

  test('filters by text (case-insensitive substring)', () => {
    const buf = new LogRingBuffer(10)
    buf.push(makeEntry({ msg: 'Calling generateText' }))
    buf.push(makeEntry({ msg: 'Task created' }))

    const results = buf.search({ q: 'generatetext' })
    expect(results).toHaveLength(1)
    expect(results[0]!.msg).toBe('Calling generateText')
  })

  test('combines filters with AND', () => {
    const buf = new LogRingBuffer(10)
    buf.push(makeEntry({ level: 30, scope: 'bot', msg: 'received message' }))
    buf.push(makeEntry({ level: 30, scope: 'llm-orch', msg: 'calling generateText' }))
    buf.push(makeEntry({ level: 50, scope: 'llm-orch', msg: 'error in generateText' }))

    const results = buf.search({ level: 40, scope: 'llm-orch' })
    expect(results).toHaveLength(1)
    expect(results[0]!.msg).toBe('error in generateText')
  })

  test('respects limit (returns last N)', () => {
    const buf = new LogRingBuffer(10)
    for (let i = 0; i < 5; i++) {
      buf.push(makeEntry({ msg: `msg-${i}` }))
    }

    const results = buf.search({ limit: 2 })
    expect(results).toHaveLength(2)
    expect(results[0]!.msg).toBe('msg-3')
    expect(results[1]!.msg).toBe('msg-4')
  })

  test('defaults to limit 100', () => {
    const buf = new LogRingBuffer(200)
    for (let i = 0; i < 150; i++) {
      buf.push(makeEntry({ msg: `msg-${i}` }))
    }

    const results = buf.search({})
    expect(results).toHaveLength(100)
  })

  test('returns empty array on empty buffer', () => {
    const buf = new LogRingBuffer(10)
    expect(buf.search({})).toEqual([])
  })
})

describe('stats', () => {
  test('returns zeros and nulls for empty buffer', () => {
    const buf = new LogRingBuffer(10)
    expect(buf.stats()).toEqual({ count: 0, capacity: 10, oldest: null, newest: null })
  })

  test('returns correct metadata', () => {
    const buf = new LogRingBuffer(10)
    buf.push(makeEntry({ time: '2026-03-28T10:00:00.000Z' }))
    buf.push(makeEntry({ time: '2026-03-28T10:00:01.000Z' }))

    const s = buf.stats()
    expect(s.count).toBe(2)
    expect(s.capacity).toBe(10)
    expect(s.oldest).toBe('2026-03-28T10:00:00.000Z')
    expect(s.newest).toBe('2026-03-28T10:00:01.000Z')
  })

  test('reflects wrap-around correctly', () => {
    const buf = new LogRingBuffer(3)
    buf.push(makeEntry({ time: '2026-03-28T10:00:00.000Z' }))
    buf.push(makeEntry({ time: '2026-03-28T10:00:01.000Z' }))
    buf.push(makeEntry({ time: '2026-03-28T10:00:02.000Z' }))
    buf.push(makeEntry({ time: '2026-03-28T10:00:03.000Z' }))

    const s = buf.stats()
    expect(s.count).toBe(3)
    expect(s.oldest).toBe('2026-03-28T10:00:01.000Z')
    expect(s.newest).toBe('2026-03-28T10:00:03.000Z')
  })
})

describe('logBufferStream', () => {
  afterEach(() => {
    logBuffer.clear()
  })

  test('write parses JSON and pushes to default buffer', () => {
    const entry = { level: 30, time: '2026-03-28T10:00:00.000Z', msg: 'hello' }
    logBufferStream.write(JSON.stringify(entry) + '\n')

    const all = logBuffer.entries()
    expect(all).toHaveLength(1)
    expect(all[0]!.msg).toBe('hello')
  })

  test('write skips malformed JSON silently', () => {
    logBufferStream.write('not json\n')
    expect(logBuffer.entries()).toHaveLength(0)
  })
})

describe('SSE emission', () => {
  test('push emits log:entry on event bus', () => {
    const listener = mock(() => {})
    subscribe(listener)

    try {
      const buf = new LogRingBuffer(10)
      buf.push(makeEntry({ msg: 'test event' }))

      expect(listener).toHaveBeenCalledTimes(1)
      const event = listener.mock.calls[0]![0] as DebugEvent
      expect(event.type).toBe('log:entry')
      expect(event.data['msg']).toBe('test event')
    } finally {
      unsubscribe(listener)
    }
  })
})
```

**Step 2: Run test to verify it fails**

Run: `bun test tests/debug/log-buffer.test.ts`

Expected: FAIL — module `../../src/debug/log-buffer.js` not found.

**Step 3: Commit**

```bash
git add tests/debug/log-buffer.test.ts
git commit -m "test(debug): add log buffer unit tests (red)"
```

**Note:** Pre-commit hook runs typecheck which will fail on the missing module. Use `--no-verify` for this red commit (same pattern as Session 1).

---

### Task 3: Log Buffer — Implementation

**Files:**

- Create: `src/debug/log-buffer.ts`

**Step 1: Write the implementation**

```typescript
import { emit } from './event-bus.js'

export type LogEntry = {
  level: number
  time: string
  scope?: string
  msg: string
  [key: string]: unknown
}

type SearchParams = {
  level?: number
  scope?: string
  q?: string
  limit?: number
}

type BufferStats = {
  count: number
  capacity: number
  oldest: string | null
  newest: string | null
}

const DEFAULT_CAPACITY = 65535

function getCapacity(): number {
  const env = process.env['DEBUG_LOG_BUFFER_SIZE']
  if (env !== undefined && env !== '') {
    const parsed = Number.parseInt(env, 10)
    if (!Number.isNaN(parsed) && parsed > 0) return parsed
  }
  return DEFAULT_CAPACITY
}

/** @public -- used directly by tests with small capacity */
export class LogRingBuffer {
  private buffer: LogEntry[] = []
  private head = 0
  readonly capacity: number

  constructor(capacity: number = getCapacity()) {
    this.capacity = capacity
  }

  push(entry: LogEntry): void {
    if (this.buffer.length < this.capacity) {
      this.buffer.push(entry)
    } else {
      this.buffer[this.head] = entry
      this.head = (this.head + 1) % this.capacity
    }
    emit('log:entry', entry as Record<string, unknown>)
  }

  entries(): LogEntry[] {
    if (this.buffer.length < this.capacity) return this.buffer.slice()
    return [...this.buffer.slice(this.head), ...this.buffer.slice(0, this.head)]
  }

  search(params: SearchParams): LogEntry[] {
    let results = this.entries()
    if (params.level !== undefined) {
      results = results.filter((e) => e.level >= params.level!)
    }
    if (params.scope !== undefined) {
      results = results.filter((e) => e.scope === params.scope)
    }
    if (params.q !== undefined) {
      const lower = params.q.toLowerCase()
      results = results.filter((e) => e.msg.toLowerCase().includes(lower))
    }
    const limit = params.limit ?? 100
    return results.slice(-limit)
  }

  stats(): BufferStats {
    if (this.buffer.length === 0) return { count: 0, capacity: this.capacity, oldest: null, newest: null }
    const all = this.entries()
    return {
      count: this.buffer.length,
      capacity: this.capacity,
      oldest: all[0]!.time,
      newest: all[all.length - 1]!.time,
    }
  }

  clear(): void {
    this.buffer.length = 0
    this.head = 0
  }
}

/** @public -- default instance, used by server.ts routes */
export const logBuffer = new LogRingBuffer()

/** @public -- pino DestinationStream adapter, attached via logMultistream.add() */
export const logBufferStream = {
  write(chunk: string): void {
    try {
      const entry = JSON.parse(chunk) as LogEntry
      logBuffer.push(entry)
    } catch {
      // Skip malformed lines — pino always writes valid JSON, but be defensive
    }
  },
}
```

**Step 2: Run tests to verify they pass**

Run: `bun test tests/debug/log-buffer.test.ts`

Expected: All tests pass.

**Step 3: Run all debug tests (no regression)**

Run: `bun test tests/debug/`

Expected: All pass (5 event-bus + 4 state-collector + 4 server + log-buffer tests).

**Troubleshooting:**

- **TypeScript error on `entry as Record<string, unknown>`**: `LogEntry` has `[key: string]: unknown` index signature, so it should be assignable to `Record<string, unknown>`. If TypeScript still complains, the cast is correct as-is.
- **knip reports unused exports**: `LogRingBuffer` is imported by tests, which knip counts as usage. `logBuffer` and `logBufferStream` will be used by server.ts in Task 5. The `@public` tags are added as safety.

**Step 4: Commit**

```bash
git add src/debug/log-buffer.ts
git commit -m "feat(debug): add log ring buffer with search and stream adapter"
```

---

### Task 4: Server Log Routes — Tests

**Files:**

- Modify: `tests/debug/server.test.ts`

**Context:** The server test already starts `Bun.serve()` in `beforeAll`. We add tests for the new `/logs` and `/logs/stats` routes. These tests will fail with 404 because the routes don't exist yet in `server.ts`. Typecheck passes because the test file only imports from `server.js` (which exists).

**Step 1: Add test cases to the existing describe block**

After the existing `'SSE client receives state:init on connect'` test, add:

```typescript
test('GET /logs returns JSON array', async () => {
  const res = await fetch(`http://localhost:${TEST_PORT}/logs`)
  expect(res.status).toBe(200)
  expect(res.headers.get('content-type')).toBe('application/json')
  const body = (await res.json()) as unknown[]
  expect(Array.isArray(body)).toBe(true)
  // Should contain at least the "Debug server started" log
  expect(body.length).toBeGreaterThan(0)
})

test('GET /logs supports level filter', async () => {
  const res = await fetch(`http://localhost:${TEST_PORT}/logs?level=50`)
  expect(res.status).toBe(200)
  const body = (await res.json()) as Array<{ level: number }>
  for (const entry of body) {
    expect(entry.level).toBeGreaterThanOrEqual(50)
  }
})

test('GET /logs supports scope filter', async () => {
  const res = await fetch(`http://localhost:${TEST_PORT}/logs?scope=debug-server`)
  expect(res.status).toBe(200)
  const body = (await res.json()) as Array<{ scope: string }>
  expect(body.length).toBeGreaterThan(0)
  for (const entry of body) {
    expect(entry.scope).toBe('debug-server')
  }
})

test('GET /logs supports text search', async () => {
  const res = await fetch(`http://localhost:${TEST_PORT}/logs?q=Debug%20server`)
  expect(res.status).toBe(200)
  const body = (await res.json()) as Array<{ msg: string }>
  expect(body.length).toBeGreaterThan(0)
  for (const entry of body) {
    expect(entry.msg.toLowerCase()).toContain('debug server')
  }
})

test('GET /logs supports limit', async () => {
  const res = await fetch(`http://localhost:${TEST_PORT}/logs?limit=1`)
  expect(res.status).toBe(200)
  const body = (await res.json()) as unknown[]
  expect(body).toHaveLength(1)
})

test('GET /logs/stats returns buffer metadata', async () => {
  const res = await fetch(`http://localhost:${TEST_PORT}/logs/stats`)
  expect(res.status).toBe(200)
  expect(res.headers.get('content-type')).toBe('application/json')
  const body = (await res.json()) as { count: number; capacity: number; oldest: string | null; newest: string | null }
  expect(body.count).toBeGreaterThan(0)
  expect(body.capacity).toBe(65535)
  expect(body.oldest).not.toBeNull()
  expect(body.newest).not.toBeNull()
})
```

**Step 2: Run tests to verify new tests fail**

Run: `bun test tests/debug/server.test.ts`

Expected: Existing 4 tests pass, new 6 tests fail (routes return 404 instead of 200).

**Step 3: Commit**

```bash
git add tests/debug/server.test.ts
git commit -m "test(debug): add log route integration tests (red)"
```

---

### Task 5: Server Log Routes + Wiring

**Files:**

- Modify: `src/debug/server.ts`

**Context:** Add imports for `logMultistream`, `logBuffer`, `logBufferStream`. Connect the buffer stream in `startDebugServer()`. Add route handlers for `/logs` and `/logs/stats` before the 404 fallback.

**Step 1: Replace `src/debug/server.ts` with the updated version**

```typescript
import { logger, logMultistream } from '../logger.js'
import { logBuffer, logBufferStream } from './log-buffer.js'
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
  logMultistream.add({ stream: logBufferStream })

  const port = getPort()

  server = Bun.serve({
    port,
    idleTimeout: 0,
    fetch(req) {
      const url = new URL(req.url)

      if (url.pathname === '/events') {
        let ctrl: ReadableStreamDefaultController
        const stream = new ReadableStream({
          start(controller): void {
            ctrl = controller
            addClient(controller)
            req.signal.addEventListener('abort', () => {
              removeClient(controller)
            })
          },
          cancel(): void {
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

      if (url.pathname === '/logs') {
        const level = url.searchParams.get('level')
        const scope = url.searchParams.get('scope')
        const q = url.searchParams.get('q')
        const limit = url.searchParams.get('limit')

        const results = logBuffer.search({
          level: level !== null ? Number.parseInt(level, 10) : undefined,
          scope: scope ?? undefined,
          q: q ?? undefined,
          limit: limit !== null ? Number.parseInt(limit, 10) : undefined,
        })

        return new Response(JSON.stringify(results), {
          headers: { 'Content-Type': 'application/json' },
        })
      }

      if (url.pathname === '/logs/stats') {
        return new Response(JSON.stringify(logBuffer.stats()), {
          headers: { 'Content-Type': 'application/json' },
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
    void server.stop()
    server = null
    log.info('Debug server stopped')
  }
}
```

Changes from original:

- Added imports: `logMultistream` from `logger.js`, `logBuffer` + `logBufferStream` from `log-buffer.js`
- Added `logMultistream.add({ stream: logBufferStream })` at start of `startDebugServer()`
- Added `/logs` route with query param parsing and search delegation
- Added `/logs/stats` route
- Route order: `/events` → `/logs` → `/logs/stats` → `/dashboard` → 404

**Step 2: Run server tests to verify all pass**

Run: `bun test tests/debug/server.test.ts`

Expected: All 10 tests pass (4 existing + 6 new).

**Step 3: Run all debug tests (no regression)**

Run: `bun test tests/debug/`

Expected: All pass (event-bus + state-collector + log-buffer + server).

**Step 4: Commit**

```bash
git add src/debug/server.ts
git commit -m "feat(debug): add /logs and /logs/stats routes with ring buffer wiring"
```

---

### Task 6: Format + Full Checks

**Files:**

- Possibly: any files touched by formatter

**Step 1: Format all new/modified files**

Run: `bun format`

**Step 2: Run full checks**

Run: `bun check:verbose`

Expected: All checks pass — lint, typecheck, format, knip, tests, duplicates, mock-pollution.

**Troubleshooting:**

- **knip reports unused exports**: Verify `@public` tags are on:
  - `logMultistream` in `src/logger.ts` (used via dynamic import chain from `src/index.ts` → `src/debug/server.ts`)
  - `LogRingBuffer` in `src/debug/log-buffer.ts` (used by tests)
  - `logBuffer` and `logBufferStream` in `src/debug/log-buffer.ts` (used by `server.ts`)
- **typecheck error on `Record<string, unknown>` cast**: The `LogEntry` type has `[key: string]: unknown` index signature, making it compatible. If strict mode rejects `entry as Record<string, unknown>`, use `entry as unknown as Record<string, unknown>`.
- **lint errors**: Run `bun lint:fix` to auto-fix, then re-check.
- **mock-pollution**: The log buffer test imports `event-bus.ts` directly (no mocking) and uses `subscribe/unsubscribe` with cleanup. No pollution risk.

**Step 3: Commit if formatting changed files**

```bash
git add -u
git commit -m "style: format session 2 files"
```

---

### Verification Checklist

After all tasks are complete, verify the acceptance criteria manually:

1. **Logs captured**: `DEBUG_SERVER=true bun start` — wait a few seconds, then `curl http://localhost:9100/logs` — should return JSON array with bot startup logs
2. **Filtered search**: `curl 'http://localhost:9100/logs?level=30&scope=main'` — returns only info+ level logs from the `main` scope
3. **Text search**: `curl 'http://localhost:9100/logs?q=Starting'` — returns logs containing "Starting"
4. **Buffer stats**: `curl http://localhost:9100/logs/stats` — returns `{ "count": N, "capacity": 65535, "oldest": "...", "newest": "..." }`
5. **Stdout unaffected**: Terminal still shows normal pino JSON output
6. **No overhead when disabled**: `bun start` (without `DEBUG_SERVER`) — bot runs normally, no debug port opened
7. **SSE still works**: `curl -N http://localhost:9100/events` — receives `state:init` event
8. **All checks green**: `bun check:verbose` — all pass
