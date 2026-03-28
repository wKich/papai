# Debug Tracing Tool Design

**Date:** 2026-03-27
**Status:** Approved
**Scope:** Development + staging debug tooling with web UI

## Overview

A debug tracing tool embedded in papai that provides real-time visibility into application state, LLM interactions, and logs via a web dashboard. Activated by environment variable (`DEBUG_SERVER=true`), zero overhead when disabled.

## Architecture

```
┌─────────────────────────────────────────────────────────────┐
│  papai process                                              │
│                                                             │
│  ┌──────────┐    pino.multistream()    ┌────────────────┐   │
│  │  pino     │───── stdout (normal) ──>│ terminal        │   │
│  │  logger   │───── stream #2 ────────>│ Pinorama Server │   │
│  └──────────┘                          │ (Fastify plugin,│   │
│                                        │  embedded,      │   │
│  ┌──────────────────────┐              │  port 9100)     │   │
│  │  debug-server.ts     │              │                 │   │
│  │  ┌─ SSE /events <───────────────── │  + custom routes│   │
│  │  │  streams state    │              └────────────────┘   │
│  │  │  changes in       │                     ^             │
│  │  │  real-time        │              pinorama-client      │
│  │  └───────────────────┘                     │             │
│  │                                            │             │
│  │  ┌─ GET /dashboard ──> static HTML ────────┘             │
│  │  │  (single file,     queries logs                       │
│  │  │   pinorama-client                                     │
│  │  │   + SSE listener)                                     │
│  └──┴───────────────────────────────────────────────────    │
│                                                             │
│  ┌──────────┐  ┌───────────┐  ┌────────┐                   │
│  │  bot.ts   │  │ llm-orch. │  │ cache  │ ── emits events  │
│  └──────────┘  └───────────┘  └────────┘    to SSE bus     │
└─────────────────────────────────────────────────────────────┘
```

**Key decisions:**

- **Single port (9100)** -- Pinorama Server (Fastify plugin) hosts log search API, SSE stream, and dashboard HTML
- **Pinorama Server embedded in-process** -- Fastify instance inside papai when `DEBUG_SERVER=true`
- **pino.multistream()** (synchronous, main-thread) -- avoids Bun Worker Thread compatibility issues with pino transports
- **SSE for all state** -- no REST polling; dashboard is a pure SSE consumer (except log search via pinorama-client)
- **Single static HTML dashboard** -- served from `GET /dashboard`, no build step
- **Environment variable toggle** -- `DEBUG_SERVER=true` enables, absent = zero overhead
- **Fixed default port** -- `localhost:9100`, overridable via `DEBUG_PORT`

## SSE Event System

Lightweight event bus (`src/debug/event-bus.ts`) with zero-overhead guard:

```typescript
const listeners = new Set<(event: DebugEvent) => void>()

export function emit(type: string, data: Record<string, unknown>) {
  if (listeners.size === 0) return // zero overhead when no debug server
  const event = { type, timestamp: Date.now(), data }
  for (const fn of listeners) fn(event)
}
```

### Event Types

#### Lifecycle events (granular, real-time)

| Event type         | Source              | Payload                                               |
| ------------------ | ------------------- | ----------------------------------------------------- |
| `message:received` | bot.ts              | `{ userId, contextId, textLength, isCommand }`        |
| `message:replied`  | bot.ts              | `{ userId, contextId, textLength, duration }`         |
| `llm:start`        | llm-orchestrator.ts | `{ userId, model, messageCount, toolCount }`          |
| `llm:tool_call`    | llm-orchestrator.ts | `{ userId, toolName, args, stepIndex }`               |
| `llm:tool_result`  | llm-orchestrator.ts | `{ userId, toolName, duration, resultPreview }`       |
| `llm:end`          | llm-orchestrator.ts | `{ userId, model, steps, totalDuration, tokenUsage }` |
| `llm:error`        | llm-orchestrator.ts | `{ userId, error, model }`                            |
| `cache:load`       | cache.ts            | `{ userId, field, source }`                           |
| `cache:sync`       | cache.ts            | `{ userId, field }`                                   |
| `cache:expire`     | cache.ts            | `{ userId }`                                          |
| `trim:start`       | conversation.ts     | `{ userId, historyLength }`                           |
| `trim:end`         | conversation.ts     | `{ userId, kept, dropped, newSummary }`               |
| `auth:check`       | bot.ts              | `{ userId, result }`                                  |

#### State snapshot events (full state embedded)

| Event type       | Payload                                                                                         | Trigger                                             |
| ---------------- | ----------------------------------------------------------------------------------------------- | --------------------------------------------------- |
| `state:init`     | `{ sessions[], stats{}, recentLlm[] }`                                                          | New SSE connection (bootstrap)                      |
| `state:sessions` | `{ sessions: [{ userId, lastAccessed, historyLength, factsCount, hasSummary, configKeys[] }] }` | Session change (new, expired, updated)              |
| `state:cache`    | `{ userId, history (last 10), summary, facts[], config {}, workspaceId, toolCount }`            | Any cache mutation for that user                    |
| `state:stats`    | `{ uptime, activeSessions, totalMessages, totalLlmCalls, totalToolCalls }`                      | On `message:replied` / `llm:end` (debounced ~500ms) |
| `llm:full`       | `{ userId, model, messages (truncated), toolCalls[], tokenUsage, duration, error? }`            | On `llm:end` -- dashboard accumulates client-side   |

## Dashboard UI

Single static HTML file (`src/debug/dashboard.html`), ~400-500 lines. Vanilla JS + EventSource + pinorama-client via ESM CDN.

```
┌─────────────────────────────────────────────────────┐
│  papai debug · # connected · uptime 2h13m           │
│  sessions: 3 · messages: 147 · llm calls: 89       │
├────────────────────┬────────────────────────────────┤
│                    │                                │
│  SESSIONS          │  LOG EXPLORER                  │
│                    │                                │
│  > user:123  *     │  [scope v] [level v] [search]  │
│    history: 24     │                                │
│    facts: 5        │  12:03:01 info  llm-orch       │
│    summary: yes    │    Calling generateText        │
│                    │  12:03:02 debug llm-orch       │
│  > user:456        │    Tool call: search_tasks     │
│    history: 8      │  12:03:03 info  llm-orch       │
│    facts: 2        │    Response generated (1.2s)   │
│                    │                                │
├────────────────────┤                                │
│                    │                                │
│  LLM TRACE         │                                │
│                    │                                │
│  12:03:01 user:123 │                                │
│  model: gpt-4o     │                                │
│  steps: 3          │                                │
│  tools: search,    │                                │
│    get_task        │                                │
│  tokens: 1.2k/340  │                                │
│  duration: 1.2s    │                                │
│                    │                                │
└────────────────────┴────────────────────────────────┘
```

**4 panels:**

1. **Header** -- SSE connection status, global stats from `state:stats`
2. **Sessions (left top)** -- from `state:sessions`, click to expand full cache via `state:cache`
3. **LLM Trace (left bottom)** -- chronological `llm:full` events, click for detail (messages, tool calls, tokens)
4. **Log Explorer (right)** -- pinorama-client queries against Pinorama Server. Filter by scope, level, userId.

## HTTP Endpoints

Only two:

| Endpoint         | Purpose                                                    |
| ---------------- | ---------------------------------------------------------- |
| `GET /events`    | SSE stream -- single data channel for all state and events |
| `GET /dashboard` | Serves the static HTML dashboard                           |

Plus Pinorama's own routes under `/pinorama/*` (search, aggregation, stats -- consumed by pinorama-client in the dashboard).

## New Files

| File                           | Purpose                                                       | ~Lines |
| ------------------------------ | ------------------------------------------------------------- | ------ |
| `src/debug/event-bus.ts`       | Event emitter, subscribe/unsubscribe, zero-overhead guard     | ~30    |
| `src/debug/server.ts`          | Fastify instance, Pinorama plugin, SSE route, dashboard route | ~120   |
| `src/debug/pino-stream.ts`     | Writable stream forwarding logs to Pinorama bulk insert       | ~40    |
| `src/debug/state-collector.ts` | Subscribes to bus, builds snapshots, manages SSE broadcast    | ~80    |
| `src/debug/dashboard.html`     | Static 4-panel dashboard                                      | ~500   |

**Total new:** ~770 lines across 5 files.

## Changes to Existing Files

| File                      | Change                                                                        | ~Lines |
| ------------------------- | ----------------------------------------------------------------------------- | ------ |
| `src/logger.ts`           | When `DEBUG_SERVER=true`, use `pino.multistream()` (stdout + pinorama stream) | ~10    |
| `src/index.ts`            | Conditional debug server startup                                              | ~5     |
| `src/bot.ts`              | Add `emit()` calls for message lifecycle + auth                               | ~8     |
| `src/llm-orchestrator.ts` | Add `emit()` calls for LLM tracing                                            | ~12    |
| `src/cache.ts`            | Add `emit()` calls for cache mutations + state snapshots                      | ~8     |
| `src/conversation.ts`     | Add `emit()` calls for trim events                                            | ~4     |
| `package.json`            | Add fastify, pinorama-server, pinorama-client deps; `start:debug` script      | ~5     |

**Total changes:** ~50 lines of additions to existing files.

## Dev Session Decomposition

```
Session 1 (event bus + server) ──┬──> Session 3 (instrumentation) ──> Session 4 (dashboard)
Session 2 (pino + pinorama)  ────┘
```

### Session 1: Event Bus + Debug Server Skeleton

**Scope:**

- `src/debug/event-bus.ts`
- `src/debug/server.ts` (Fastify + SSE endpoint + placeholder dashboard)
- `src/debug/state-collector.ts` (SSE client management + broadcast)
- `src/index.ts` conditional startup
- `package.json` fastify dependency + `start:debug` script
- Unit tests for event bus and SSE connection

**Acceptance criteria:**

- `DEBUG_SERVER=true bun start` opens port 9100
- `curl localhost:9100/events` receives SSE stream
- Bot runs normally without `DEBUG_SERVER` set
- Event bus emit() is a no-op with zero overhead when no listeners

### Session 2: Pino Log Pipeline (revised — ring buffer, no pinorama)

> **Revised:** pinorama-server requires Fastify (Session 1 used `Bun.serve()`), pinorama-transport uses Worker Threads (broken on Bun). Replaced with zero-dependency in-memory ring buffer. Full design: `docs/plans/2026-03-28-session2-pino-log-pipeline-design.md`

**Scope:**

- `src/debug/log-buffer.ts` — ring buffer (65535 entries) + writable stream adapter
- `src/logger.ts` — always-multistream (`pino.multistream([stdout])`) with dynamic `.add()`
- `src/debug/server.ts` — add `GET /logs` and `GET /logs/stats` routes, connect buffer on startup
- No new dependencies

**Acceptance criteria:**

- `curl localhost:9100/logs` returns JSON array of recent log entries
- `curl localhost:9100/logs?level=40&scope=main` returns filtered results
- `curl localhost:9100/logs/stats` returns buffer metadata
- Normal stdout logging unaffected
- No new dependencies added

### Session 3: Instrument Source Modules

**Scope:**

- Add `emit()` calls to `bot.ts`, `llm-orchestrator.ts`, `cache.ts`, `conversation.ts`
- Emit state snapshots (`state:init`, `state:sessions`, `state:cache`, `state:stats`, `llm:full`)
- Ring buffer for recent LLM calls
- Global stats counters

**Acceptance criteria:**

- SSE stream shows real-time events when sending messages to the bot
- `state:init` fires on new SSE connection with full current state
- State snapshots reflect actual in-memory state accurately
- Zero overhead when `DEBUG_SERVER` not set (no listeners = no-op)

### Session 4: Dashboard HTML

**Scope:**

- `src/debug/dashboard.html` (4-panel layout)
- SSE consumer for header, sessions, LLM trace panels
- Log explorer panel via `GET /logs` REST API + SSE `log:entry` events for live tailing
- Serve at `GET /dashboard`

**Acceptance criteria:**

- `localhost:9100/dashboard` opens in browser
- Header shows live connection status and stats
- Sessions panel updates in real-time as users interact
- LLM trace panel shows tool calls, tokens, durations
- Log explorer searches and filters logs via ring buffer REST API
