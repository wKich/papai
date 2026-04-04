# Session 4: Dashboard HTML — Design

**Date:** 2026-03-29
**Status:** Approved
**Parent:** `docs/plans/2026-03-27-debug-tracing-tool-design.md`
**Scope:** Static debug dashboard served from the existing debug server

## Overview

Single-page debug dashboard served at `GET /dashboard` from the existing debug server (port 9100). Consumes SSE events from `GET /events` and bootstraps log history from `GET /logs`. All state management and filtering is client-side. No external dependencies.

## File Structure

| File                           | Purpose                                                          | ~Lines |
| ------------------------------ | ---------------------------------------------------------------- | ------ |
| `src/debug/dashboard.html`     | Markup — structure, no inline styles/scripts                     | ~80    |
| `src/debug/dashboard.css`      | Styling — dark terminal theme, grid layout, log level colors     | ~200   |
| `src/debug/dashboard-ui.ts`    | Render functions, DOM event listeners, auto-scroll, filter logic | ~180   |
| `src/debug/dashboard-state.ts` | State object, SSE connection, event handler dispatch             | ~180   |
| `src/debug/server.ts`          | **modify** — static file handler + `Bun.build()` at startup      | ~20    |

**Total:** ~640 new lines, ~20 modified lines.

### TypeScript for Client-Side JS

Dashboard JS files are authored as TypeScript (`.ts`) for type safety, editor support, and linting. At `startDebugServer()`, `Bun.build()` transpiles them to JS strings cached in a `Map<string, string>`. The HTML references them as `.js` files; the route handler serves the cached JS with `text/javascript` content type.

```ts
// server.ts — at startup
const result = await Bun.build({
  entrypoints: ['src/debug/dashboard-state.ts', 'src/debug/dashboard-ui.ts'],
})
// cache result.outputs as JS strings in a Map
```

Benefits:

- `bun typecheck` catches errors in dashboard code
- `bun lint` applies normally — no lint rule exceptions needed
- No build step in dev workflow — transpilation happens once at server start

## Serving

Single static file route in `server.ts` replaces the existing placeholder `/dashboard` route.

```
GET /dashboard            → src/debug/dashboard.html     (text/html)
GET /dashboard.css        → src/debug/dashboard.css      (text/css)
GET /dashboard-state.js   → cached transpiled JS         (text/javascript)
GET /dashboard-ui.js      → cached transpiled JS         (text/javascript)
GET /dashboard.xyz        → 404
```

The handler matches `/dashboard` and `/dashboard.*`, validates the extension against an allowlist (`html`, `css`, `js`), and serves accordingly. HTML and CSS are served via `Bun.file()`. JS files are served from the in-memory cache.

## Layout

4-panel layout using CSS Grid + flexbox:

```
body
├── header              (full width, sticky top)
│   ├── header-top      (title, connection status, uptime, stats)
│   └── header-infra    (scheduler, pollers, message cache indicators)
└── main                (CSS grid: 300px | 1fr, fills remaining viewport)
    ├── aside           (left column, flex-column, scrollable)
    │   ├── #sessions   (flex: 0 auto)
    │   └── #llm-trace  (flex: 1, scrollable)
    └── #log-explorer   (right column, flex-column)
        ├── .log-toolbar  (flex: 0 auto)
        ├── #log-entries  (flex: 1, scrollable)
        └── #log-autoscroll (positioned bottom-right)
```

### Header

```
┌─────────────────────────────────────────────────────────────────────────────┐
│  papai debug                                                                │
│                                                                             │
│  ● connected    uptime 2h13m    msgs: 147    llm: 89    tools: 212         │
│                                                                             │
│  scheduler: running (tick #142)  │  pollers: scheduled ● alerts ●          │
│  msg-cache: 24 entries, 0 pending                                           │
└─────────────────────────────────────────────────────────────────────────────┘
```

- **Row 1:** Title + SSE connection indicator (green dot = connected, red = disconnected)
- **Row 2:** Global stats from `state:stats` — uptime (computed from `startedAt`), `totalMessages`, `totalLlmCalls`, `totalToolCalls`
- **Row 3:** Infrastructure indicators — compact one-liner each:
  - **Scheduler:** "running" / "stopped" + tick count. Updated on `scheduler:tick`.
  - **Pollers:** two dot indicators (green = running, grey = stopped). Updated on `poller:scheduled` / `poller:alerts`.
  - **Message cache:** entry count + pending writes. Updated on `msgcache:sweep`.

### Sessions Panel (left top)

Bootstrapped from `state:init.sessions`. Each session is a card showing:

- userId, history length, facts count, summary (yes/no), config key count, workspace
- Green left border for active sessions (recent `cache:load`/`cache:sync`), dim for idle
- Wizard icon + step progress if an active wizard session exists for that user

Updated client-side via:

- `cache:load` / `cache:sync` → update session fields
- `cache:expire` → remove session card
- `wizard:created` / `wizard:updated` / `wizard:deleted` → update wizard state on session card

### LLM Trace Panel (left bottom)

Chronological list of `llm:full` events, newest on top. Bootstrapped from `state:init.recentLlm`.

**Collapsed row:** timestamp, userId, model, duration, step count, input tokens.

**Expanded row (click to toggle):** inline detail section showing:

- Tool calls list: name, duration, success/failure indicator
- Token breakdown: input / output
- Error message if present

Error traces highlighted with red left border.

Click handler via event delegation on `#trace-list`, toggling `data-expanded` attribute.

### Log Explorer Panel (right)

**Data flow:**

1. On page load: `fetch('/logs')` → populate `state.logs` with backlog (up to 65,535 entries)
2. SSE `log:entry` events → append to `state.logs`, evict oldest if over 65,535 cap
3. Search/filter applied client-side via `Array.filter()` on `state.logs`

**No REST calls after initial bootstrap.** All filtering is in-memory.

**Toolbar:**

- Level dropdown: debug / info / warn / error (filters `entry.level >= selected`)
- Scope dropdown: populated dynamically from seen `entry.scope` values
- Free-text search: substring match on `entry.msg`
- Clear button: empties client-side buffer

**Log rows:**

- Colored by level: debug=dim grey, info=green, warn=amber, error=red
- Two lines per entry: timestamp + level + scope on line 1, message indented on line 2
- Alternating row tint for readability

**Auto-scroll:**

- Pinned to bottom by default
- Scrolling up disengages auto-scroll
- Floating "▼ auto-scroll" button appears to re-engage
- Threshold: `scrollHeight - scrollTop - clientHeight < 50`

## Visual Theme

Terminal/hacker dark theme, monospace throughout.

| Element          | Value                                                       |
| ---------------- | ----------------------------------------------------------- |
| Background       | `#0a0a0a`                                                   |
| Panel background | `#111111`                                                   |
| Borders          | `#222222`                                                   |
| Primary text     | `#cccccc`                                                   |
| Secondary text   | `#666666`                                                   |
| Accent           | `#00ff88`                                                   |
| Font             | `'JetBrains Mono', 'Fira Code', 'Cascadia Code', monospace` |
| Base font size   | `12px`                                                      |

**Log level colors:**

| Level | Color                |
| ----- | -------------------- |
| debug | `#555555` (dim grey) |
| info  | `#00ff88` (green)    |
| warn  | `#ffaa00` (amber)    |
| error | `#ff4444` (red)      |

**Accents:**

- Active session card: `border-left: 2px solid #00ff88`
- Error LLM trace: `border-left: 2px solid #ff4444`
- Connection status: CSS pulse animation when connected, static red when disconnected
- Inputs/dropdowns: dark background (`#1a1a1a`), green border on focus

No responsive breakpoints — desktop dev tool only.

## JavaScript Architecture

### State (dashboard-state.ts)

```ts
const state = {
  connected: false,
  stats: { startedAt: 0, totalMessages: 0, totalLlmCalls: 0, totalToolCalls: 0 },
  sessions: new Map(), // userId → SessionSnapshot
  wizards: new Map(), // userId → WizardSnapshot
  scheduler: {}, // SchedulerSnapshot
  pollers: {}, // PollerSnapshot
  messageCache: {}, // MessageCacheSnapshot
  llmTraces: [], // LlmTrace[], newest first
  logs: [], // LogEntry[], capped at 65535
  logScopes: new Set(), // seen scope values for dropdown
}
```

### Initialization Sequence

1. `dashboard-ui.ts` loads first — registers render functions on `window`, sets up DOM listeners
2. `dashboard-state.ts` loads second — defines state, calls `init()`
3. `init()`: `fetch('/logs')` → populate `state.logs` → open `EventSource('/events')`
4. SSE `state:init` → populate all state fields → full UI render
5. Subsequent events → update state → re-render affected panel only

### Event Handler Dispatch

```ts
const handlers = {
  'state:init': (d) => {
    /* populate all state, full render */
  },
  'state:stats': (d) => {
    /* update stats, render header */
  },
  'llm:full': (d) => {
    /* prepend to llmTraces, render trace list */
  },
  'cache:load': (d) => {
    /* update session fields, render session card */
  },
  'cache:sync': (d) => {
    /* update session fields, render session card */
  },
  'cache:expire': (d) => {
    /* delete session, render session list */
  },
  'wizard:created': (d) => {
    /* add wizard, render session card */
  },
  'wizard:updated': (d) => {
    /* update wizard, render session card */
  },
  'wizard:deleted': (d) => {
    /* delete wizard, render session card */
  },
  'scheduler:tick': (d) => {
    /* update scheduler, render header infra */
  },
  'poller:scheduled': (d) => {
    /* update pollers, render header infra */
  },
  'poller:alerts': (d) => {
    /* update pollers, render header infra */
  },
  'msgcache:sweep': (d) => {
    /* update messageCache, render header infra */
  },
  'log:entry': (d) => {
    /* push to logs, evict if >65535, render if passes filter */
  },
}
```

Each event type registered via `evtSource.addEventListener(type, ...)`.

### DOM Rendering

- **`getElementById`** — all dynamic elements have IDs, no query selectors
- **`innerHTML`** for lists — session list, trace list, log entries rebuilt by mapping state to HTML strings
- **`textContent`** for scalars — stats, counts, connection status
- **Log filtering** — `state.logs.filter(...)` applied on every log panel render, criteria read from dropdown/input values

### SSE Reconnection

`EventSource` auto-reconnects natively. On `open` → set connected, render. On `error` → set disconnected, render. On reconnect, server sends fresh `state:init` which resets all client state.

## Client-Side State Management

The dashboard maintains its own state from `state:init` bootstrap + raw lifecycle event deltas. No server-side convenience events — the state-collector forwards raw events only.

| SSE Event                            | Client-Side Action                                                                                |
| ------------------------------------ | ------------------------------------------------------------------------------------------------- |
| `state:init`                         | Full state reset — populate sessions, wizards, scheduler, pollers, messageCache, stats, recentLlm |
| `cache:load` / `cache:sync`          | Update corresponding session's fields (e.g., increment history count)                             |
| `cache:expire`                       | Remove session from sessions map                                                                  |
| `wizard:created/updated/deleted`     | Add/update/remove wizard from wizards map                                                         |
| `state:stats`                        | Replace stats counters                                                                            |
| `llm:full`                           | Prepend to LLM trace list                                                                         |
| `scheduler:tick`                     | Update scheduler tick count                                                                       |
| `poller:scheduled` / `poller:alerts` | Update poller status indicators                                                                   |
| `msgcache:sweep`                     | Update message cache counts                                                                       |
| `log:entry`                          | Append to logs array, evict oldest if >65535                                                      |

## Testing

**Automated (in `tests/debug/server.test.ts`):**

- `GET /dashboard` returns 200 with `text/html`
- `GET /dashboard.css` returns 200 with `text/css`
- `GET /dashboard-state.js` returns 200 with `text/javascript`
- `GET /dashboard-ui.js` returns 200 with `text/javascript`
- `GET /dashboard.xyz` returns 404
- Files contain expected content markers

**Manual acceptance criteria:**

- `localhost:9100/dashboard` opens in browser
- Header shows live connection status and stats
- Sessions panel bootstraps from `state:init` and updates in real-time via lifecycle event deltas
- LLM trace panel shows tool calls, tokens, durations with inline expand
- Log explorer streams entries in real-time, client-side filter/search works without pausing the stream

## Changes to Existing Files

Only `src/debug/server.ts` is modified:

1. Replace placeholder `/dashboard` route with static file handler matching `/dashboard*`
2. Add `Bun.build()` call at startup to transpile `.ts` dashboard files to JS
3. Cache transpiled JS in a `Map<string, string>`
4. Serve HTML/CSS via `Bun.file()`, JS from cache

No changes to `event-bus.ts`, `state-collector.ts`, `log-buffer.ts`, or any instrumented source files.
