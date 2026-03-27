# Session 1: Event Bus + Debug Server Skeleton

**Date:** 2026-03-28
**Status:** Approved
**Parent:** [Debug Tracing Tool Design](2026-03-27-debug-tracing-tool-design.md)
**Scope:** Event bus, debug HTTP server, SSE transport, state collector stub

## Overview

Foundation layer for the debug tracing tool. Creates the event bus that source modules will emit into (Session 3), the HTTP server that serves SSE and the dashboard (Session 4), and the state collector that bridges the two.

Activated by `DEBUG_SERVER=true`. Zero overhead when disabled.

## Architecture Change: Bun.serve() Instead of Fastify

The parent design specified Fastify as the HTTP server (because pinorama-server is a Fastify plugin). This session replaces Fastify with `Bun.serve()`:

- **Zero new dependencies** -- `Bun.serve()` is built-in
- **Native SSE** -- web `ReadableStream` API, `idleTimeout: 0` to prevent Bun's default 10s idle disconnect (oven-sh/bun#13811)
- **No Bun+Fastify friction** -- avoids `Server.setTimeout()` warning, unenforced timeout settings, incomplete `ServerResponse` API

The trade-off: pinorama-server (Orama full-text log search) is dropped. Session 2 will implement a ring buffer with `Array.filter()` for log search, which is sufficient for debug volumes (hundreds to low-thousands of logs per session).

**Impact on parent design sessions:**

| Session   | Change                                                                                                                         |
| --------- | ------------------------------------------------------------------------------------------------------------------------------ |
| Session 1 | Bun.serve() replaces Fastify                                                                                                   |
| Session 2 | Ring buffer + filter API replaces pinorama-server; custom pino stream writes to buffer directly (no pinorama-client/transport) |
| Session 3 | No change (emit calls are server-agnostic)                                                                                     |
| Session 4 | Dashboard log explorer uses custom search API instead of pinorama-client                                                       |

## New Files

### `src/debug/event-bus.ts` (~30 lines)

Minimal function-based event bus using `Set<Listener>`.

```typescript
type DebugEvent = {
  type: string
  timestamp: number
  data: Record<string, unknown>
}

type Listener = (event: DebugEvent) => void

const listeners = new Set<Listener>()

/** @public -- consumed by source modules in Session 3 */
function emit(type: string, data: Record<string, unknown>): void {
  if (listeners.size === 0) return // zero overhead when no debug server
  const event: DebugEvent = { type, timestamp: Date.now(), data }
  for (const fn of listeners) fn(event)
}

/** @public -- consumed by state-collector.ts in Session 3 */
function subscribe(fn: Listener): void {
  listeners.add(fn)
}

function unsubscribe(fn: Listener): void {
  listeners.delete(fn)
}
```

Key properties:

- **Zero overhead** -- `emit()` returns immediately when `listeners.size === 0`
- **Synchronous** -- emitters are not slowed by async; listeners queue async work internally
- **`type` is a string**, not a union -- Session 3 adds event types without changing this module
- `emit`, `subscribe` get `/** @public */` for knip (not consumed until Session 3)

### `src/debug/server.ts` (~80 lines)

HTTP server using `Bun.serve()` with two routes.

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

function startDebugServer(): void {
  const port = getPort()

  server = Bun.serve({
    port,
    idleTimeout: 0, // prevent Bun from dropping SSE connections
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

function stopDebugServer(): void {
  if (server !== null) {
    server.stop()
    server = null
    log.info('Debug server stopped')
  }
}
```

Key decisions:

- **`idleTimeout: 0`** -- prevents Bun from dropping SSE connections after 10s default idle timeout
- **Web `ReadableStream`** -- Bun-native API, no Node.js compat layer
- **`req.signal` abort + `cancel()`** -- two paths for detecting client disconnect (browser close vs stream cancel)
- **`addClient`/`removeClient` callbacks** -- delegates SSE client management to state-collector; server is stateless regarding listeners
- **Placeholder dashboard** -- returns static HTML; Session 4 replaces with full dashboard

### `src/debug/state-collector.ts` (~50 lines)

Manages SSE client connections and broadcasts events from the bus.

```typescript
import { subscribe, unsubscribe, type DebugEvent } from './event-bus.js'

const clients = new Set<ReadableStreamDefaultController>()
const encoder = new TextEncoder()

/** @public -- called by server.ts on new SSE connection */
function addClient(controller: ReadableStreamDefaultController): void {
  clients.add(controller)

  // Bootstrap: send state:init (stub -- Session 3 fills this with real state)
  sendTo(controller, { type: 'state:init', timestamp: Date.now(), data: {} })

  // Subscribe to bus on first client
  if (clients.size === 1) {
    subscribe(onEvent)
  }
}

/** @public -- called by server.ts on SSE disconnect */
function removeClient(controller: ReadableStreamDefaultController): void {
  clients.delete(controller)

  // Unsubscribe when no clients remain
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
      clients.delete(client) // client already closed
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

Key properties:

- **Lazy subscribe/unsubscribe** -- only subscribes to the bus when at least one SSE client is connected; unsubscribes when all disconnect. Preserves zero-overhead guarantee.
- **`state:init` stub** -- sends empty init event on connect. Session 3 populates with sessions/stats/recentLlm.
- **Named SSE events** -- uses `event: <type>\n` so the dashboard can use `EventSource.addEventListener('llm:end', ...)` per event type
- **Error-tolerant broadcast** -- if `controller.enqueue()` throws (closed stream), the client is silently removed
- **Shared `TextEncoder`** -- single instance, stateless, reusable
- `addClient`, `removeClient` get `/** @public */` for knip

## Changes to Existing Files

### `src/index.ts` (~10 lines added)

Dynamic import gated by `DEBUG_SERVER=true`, placed after `chatProvider.start()`:

```typescript
let stopDebugServerFn: (() => void) | null = null

if (process.env['DEBUG_SERVER'] === 'true') {
  const { startDebugServer, stopDebugServer } = await import('./debug/server.js')
  startDebugServer()
  stopDebugServerFn = stopDebugServer
}

// In both SIGINT and SIGTERM handlers, before chatProvider.stop():
stopDebugServerFn?.()
```

Key decisions:

- **Dynamic `import()`** -- entire `src/debug/` tree is never loaded unless `DEBUG_SERVER=true`. No module parsing, no memory, no event bus listeners.
- **Placement** -- starts after chat provider is running, so bot is fully operational before debug port opens
- **Graceful shutdown** -- `stopDebugServer()` added to both `SIGINT` and `SIGTERM` handlers

### `package.json` (1 line added)

```json
"start:debug": "DEBUG_SERVER=true bun run src/index.ts"
```

No new dependencies.

## Testing

### Unit: Event Bus (`tests/debug/event-bus.test.ts`)

| Test                                 | Verifies                    |
| ------------------------------------ | --------------------------- |
| emit() with no listeners is a no-op  | Zero overhead guarantee     |
| subscribe + emit delivers event      | Basic pub/sub               |
| Event has correct shape              | `{ type, timestamp, data }` |
| Multiple listeners all receive event | Broadcast                   |
| unsubscribe stops delivery           | Cleanup                     |
| timestamp is populated automatically | `Date.now()` in emit        |

No mocking needed -- direct function calls.

### Unit: State Collector (`tests/debug/state-collector.test.ts`)

| Test                                                | Verifies                   |
| --------------------------------------------------- | -------------------------- |
| addClient sends state:init immediately              | Bootstrap event            |
| Events broadcast to all connected clients           | Multi-client broadcast     |
| removeClient stops delivery                         | Cleanup                    |
| Lazy subscribe on first client, unsubscribe on last | Bus subscription lifecycle |
| Dead client (enqueue throws) removed silently       | Error tolerance            |

Uses mock `ReadableStreamDefaultController` objects. No shared module mocking.

### Integration: Server (`tests/debug/server.test.ts`)

| Test                                      | Verifies                        |
| ----------------------------------------- | ------------------------------- |
| Server starts on configured port          | Port binding                    |
| `GET /events` returns SSE headers         | Content-Type: text/event-stream |
| `GET /dashboard` returns HTML             | Content-Type: text/html         |
| Unknown route returns 404                 | Routing                         |
| SSE client receives state:init on connect | End-to-end SSE flow             |
| stopDebugServer() closes the port         | Graceful shutdown               |

Uses real HTTP requests to localhost. No shared module mocking -- `src/debug/` is self-contained.

## Acceptance Criteria

1. `DEBUG_SERVER=true bun start` opens port 9100
2. `curl localhost:9100/events` receives SSE stream with `state:init` event
3. `curl localhost:9100/dashboard` returns HTML placeholder
4. Bot runs normally without `DEBUG_SERVER` set (zero overhead -- `src/debug/` not loaded)
5. All unit and integration tests pass
6. `bun check:verbose` passes (lint, typecheck, format, knip, tests)
