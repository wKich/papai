# Session 2: Pino Log Pipeline — Design

**Date:** 2026-03-28
**Status:** Approved
**Depends on:** Session 1 (event bus + server skeleton)
**Parent design:** `docs/plans/2026-03-27-debug-tracing-tool-design.md`

## Context & Divergences from Original Design

Session 1 implemented the debug server with native `Bun.serve()` instead of Fastify. This invalidates the original Session 2 plan which assumed pinorama-server (a Fastify plugin) for log storage and search. Research confirmed:

- **pinorama-server** requires Fastify — adding Fastify as a dependency for one debug feature is not justified
- **pinorama-transport** uses Worker Threads via `thread-stream` — broken on Bun
- **pino.multistream()** is synchronous, main-thread, fully Bun-compatible

**Decision:** Replace pinorama-server with a zero-dependency in-memory ring buffer. Replace pinorama-client with REST routes on the existing `Bun.serve()`.

## Architecture

```
pino logger (all modules)
    │
    ├── stream #1: process.stdout  (always present)
    │
    └── stream #2: log-buffer      (added dynamically when DEBUG_SERVER=true)
            │
            ├── ring buffer (65535 entries, in-memory, circular)
            │       ├── GET /logs         → search/filter
            │       └── GET /logs/stats   → buffer metadata
            │
            └── emit('log:entry', ...)    → live SSE to dashboard
```

### Approach: Always-multistream with dynamic `.add()`

`logger.ts` always creates `pino(opts, pino.multistream([{ stream: process.stdout }]))` and exports the multistream reference. When `DEBUG_SERVER=true`, `startDebugServer()` calls `logMultistream.add({ stream: logBufferStream })` to attach the ring buffer.

**Trade-off:** Multistream indirection on every log call even when debug is disabled. Measured overhead is nanoseconds per call — acceptable for the simplicity of a single initialization path and no top-level await.

## Ring Buffer

```typescript
type LogEntry = {
  level: number // pino numeric: 10=trace, 20=debug, 30=info, 40=warn, 50=error
  time: string // ISO timestamp from pino
  scope?: string // from logger.child({ scope: '...' })
  msg: string // log message
  [key: string]: unknown // additional structured fields
}
```

- **Capacity:** 65535 entries default (configurable via `DEBUG_LOG_BUFFER_SIZE` env var)
- **Structure:** Circular array with head pointer — O(1) push, O(n) search where n <= capacity
- **Stream adapter:** Object with `.write(chunk: string): void` — parses pino's newline-delimited JSON, pushes to buffer, emits `log:entry` on the event bus
- **Malformed lines:** Silently skipped

### Search Parameters (all optional, combined with AND)

| Param   | Type   | Behavior                            |
| ------- | ------ | ----------------------------------- |
| `level` | number | Minimum level (>= filter)           |
| `scope` | string | Exact match on `scope` field        |
| `q`     | string | Case-insensitive substring in `msg` |
| `limit` | number | Max results, default 100            |

## HTTP Routes

Added to existing `Bun.serve()` in `server.ts`:

| Route         | Method | Response                               | Status |
| ------------- | ------ | -------------------------------------- | ------ |
| `/logs`       | GET    | `LogEntry[]` JSON array, chronological | 200    |
| `/logs/stats` | GET    | `{ count, capacity, oldest, newest }`  | 200    |

**Examples:**

```
GET /logs                              → last 100 entries
GET /logs?level=40                     → warnings and errors only
GET /logs?scope=llm-orch&limit=50      → last 50 llm-orchestrator logs
GET /logs?q=generateText               → entries where msg contains "generateText"
GET /logs?level=30&scope=main&q=start  → combined filters

GET /logs/stats  → { "count": 847, "capacity": 65535, "oldest": "2026-03-28T...", "newest": "2026-03-28T..." }
```

**Edge cases:** Empty buffer returns `[]` for `/logs` and `{ count: 0, capacity: 65535, oldest: null, newest: null }` for `/logs/stats`.

## Wiring & Initialization Order

All debug wiring lives inside `startDebugServer()`:

```
src/index.ts
  └── if DEBUG_SERVER=true:
        └── import('./debug/server.js')
              └── startDebugServer()
                    ├── import logMultistream from logger.ts
                    ├── import logBufferStream from log-buffer.ts
                    ├── logMultistream.add({ stream: logBufferStream })
                    ├── register /logs and /logs/stats routes
                    └── Bun.serve({ ... })
```

**No circular dependencies:**

- `logger.ts` → no debug imports
- `debug/log-buffer.ts` → `debug/event-bus.ts` (for SSE emission)
- `debug/server.ts` → `logger.ts` + `debug/log-buffer.ts` + `debug/state-collector.ts`

**Cleanup:** `stopDebugServer()` does not remove the stream from multistream (pino has no `.remove()` API; process shutdown follows immediately).

## File Changes

### New files

| File                             | Purpose                                                     | ~Lines |
| -------------------------------- | ----------------------------------------------------------- | ------ |
| `src/debug/log-buffer.ts`        | LogRingBuffer class, stream adapter, search/stats, SSE emit | ~80    |
| `tests/debug/log-buffer.test.ts` | Ring buffer, search, stream adapter, stats tests            | ~100   |

### Modified files

| File                         | Change                                                              | ~Lines |
| ---------------------------- | ------------------------------------------------------------------- | ------ |
| `src/logger.ts`              | `pino(opts)` → `pino(opts, pino.multistream([stdout]))`, export ref | ~5     |
| `src/debug/server.ts`        | Add `/logs` and `/logs/stats` routes, connect log buffer on start   | ~30    |
| `tests/debug/server.test.ts` | Tests for `/logs` and `/logs/stats` routes                          | ~20    |

### No changes to

- `src/index.ts` — `startDebugServer()` handles all wiring internally
- `package.json` — no new dependencies

**Total:** ~180 new lines, ~35 modified lines, 0 new dependencies.

## Error Handling

- **Stream write errors:** Silently skip — pino continues writing to stdout
- **JSON parse errors in stream:** Silently skip (defensive; pino always writes valid JSON)
- **Ring buffer overflow:** Circular overwrite by design
- **SSE emission errors:** Handled by existing event bus / state collector infrastructure

## Acceptance Criteria

- `DEBUG_SERVER=true bun start` — logs appear in ring buffer
- `curl localhost:9100/logs` — returns JSON array of recent log entries
- `curl localhost:9100/logs?level=40&scope=main` — filtered results
- `curl localhost:9100/logs/stats` — returns buffer metadata
- Normal stdout logging unaffected
- `bun start` (without DEBUG_SERVER) — no overhead beyond multistream indirection
- All existing tests pass (`bun check:verbose`)

## Updated Session Dependency Graph

```
Session 1 (event bus + server) ──┬──> Session 3 (instrumentation) ──> Session 4 (dashboard)
Session 2 (pino log pipeline)  ──┘
```

Session 4 dashboard will use:

- SSE `log:entry` events for live log tailing
- `GET /logs` for search/filter (replaces pinorama-client)
