# Session 4: Dashboard HTML — Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Build the 4-panel debug dashboard served at `GET /dashboard` from the existing debug server.

**Architecture:** Single-page HTML dashboard with CSS and two TypeScript files transpiled to JS at server startup via `Bun.build()`. Consumes SSE events from `/events` and bootstraps logs from `/logs`. All state management is client-side.

**Tech Stack:** Vanilla HTML/CSS/JS, TypeScript for client-side (transpiled by Bun), `Bun.serve()` for static file serving, `EventSource` for SSE, `fetch` for log bootstrap.

**Design doc:** `docs/plans/2026-03-29-debug-session4-dashboard-html-design.md`

---

### Task 1: Server Static File Route — Tests

**Files:**

- Modify: `tests/debug/server.test.ts`

**Step 1: Write failing tests for the new static file routes**

Add these test cases after the existing `GET /dashboard returns HTML` test. The existing test checks for the placeholder content `'papai debug dashboard'` — update it to check for actual dashboard HTML, and add tests for CSS, JS, and 404.

```typescript
test('GET /dashboard returns dashboard HTML', async () => {
  const res = await fetch(`http://localhost:${TEST_PORT}/dashboard`)
  expect(res.status).toBe(200)
  const ct = res.headers.get('content-type')
  expect(ct).toContain('text/html')
  const body = await res.text()
  expect(body).toContain('<html')
  expect(body).toContain('papai debug')
})

test('GET /dashboard.css returns CSS', async () => {
  const res = await fetch(`http://localhost:${TEST_PORT}/dashboard.css`)
  expect(res.status).toBe(200)
  const ct = res.headers.get('content-type')
  expect(ct).toContain('text/css')
  const body = await res.text()
  expect(body).toContain('#log-explorer')
})

test('GET /dashboard-state.js returns JavaScript', async () => {
  const res = await fetch(`http://localhost:${TEST_PORT}/dashboard-state.js`)
  expect(res.status).toBe(200)
  const ct = res.headers.get('content-type')
  expect(ct).toContain('javascript')
  const body = await res.text()
  expect(body).toContain('EventSource')
})

test('GET /dashboard-ui.js returns JavaScript', async () => {
  const res = await fetch(`http://localhost:${TEST_PORT}/dashboard-ui.js`)
  expect(res.status).toBe(200)
  const ct = res.headers.get('content-type')
  expect(ct).toContain('javascript')
  const body = await res.text()
  expect(body).toContain('getElementById')
})

test('GET /dashboard.xyz returns 404', async () => {
  const res = await fetch(`http://localhost:${TEST_PORT}/dashboard.xyz`)
  expect(res.status).toBe(404)
  await res.body?.cancel()
})
```

Replace the existing `test('GET /dashboard returns HTML', ...)` test (lines 33-39) with the updated version above.

**Step 2: Run tests to verify they fail**

Run: `bun test tests/debug/server.test.ts`

Expected: The new tests for `.css` and `.js` routes fail with 404 status (the current server doesn't serve them). The existing dashboard test may also fail since the content check changed.

**Step 3: Commit**

```
test(debug): add server tests for dashboard static file routes
```

---

### Task 2: Server Static File Route — Implementation

**Files:**

- Modify: `src/debug/server.ts`

Before implementing the route, we need the actual files to serve. Create minimal placeholder files first, then update the server.

**Step 1: Create minimal placeholder dashboard files**

Create three placeholder files so the server can serve them. These will be replaced with real content in later tasks.

`src/debug/dashboard.html`:

```html
<!doctype html>
<html lang="en">
  <head>
    <meta charset="utf-8" />
    <title>papai debug</title>
    <link rel="stylesheet" href="/dashboard.css" />
  </head>
  <body>
    <header id="header">
      <h1>papai debug</h1>
    </header>
    <main></main>
    <script src="/dashboard-ui.js" defer></script>
    <script src="/dashboard-state.js" defer></script>
  </body>
</html>
```

`src/debug/dashboard.css`:

```css
* {
  margin: 0;
  padding: 0;
  box-sizing: border-box;
}

body {
  background: #0a0a0a;
  color: #cccccc;
  font-family: 'JetBrains Mono', 'Fira Code', 'Cascadia Code', monospace;
  font-size: 12px;
}

#log-explorer {
  display: flex;
}
```

`src/debug/dashboard-ui.ts`:

```typescript
/// <reference lib="dom" />
/* eslint-disable -- client-side code, transpiled by Bun.build() */

document.getElementById('header')
```

`src/debug/dashboard-state.ts`:

```typescript
/// <reference lib="dom" />
/* eslint-disable -- client-side code, transpiled by Bun.build() */

const evtSource = new EventSource('/events')
void evtSource
```

**Step 2: Update `src/debug/server.ts` — add Bun.build() and static route**

In `startDebugServer()`, before `Bun.serve()`, add the `Bun.build()` call. Change `startDebugServer` to `async`. Cache the transpiled JS in a module-level `Map`. Replace the placeholder `/dashboard` route with a handler that matches `/dashboard*`.

The signature changes from:

```typescript
export function startDebugServer(adminUserId: string): void {
```

to:

```typescript
export async function startDebugServer(adminUserId: string): Promise<void> {
```

Add the transpilation and caching:

```typescript
const jsCache = new Map<string, string>()

export async function startDebugServer(adminUserId: string): Promise<void> {
  init(adminUserId)
  logMultistream.add({ stream: logBufferStream })

  // Transpile dashboard TypeScript to JS
  const buildResult = await Bun.build({
    entrypoints: [
      new URL('dashboard-state.ts', import.meta.url).pathname,
      new URL('dashboard-ui.ts', import.meta.url).pathname,
    ],
  })
  for (const output of buildResult.outputs) {
    const name = output.path.split('/').pop() ?? ''
    jsCache.set(name, await output.text())
  }

  // ... rest of Bun.serve() setup
```

Replace the `/dashboard` route block (lines 108-112) with a handler matching `/dashboard*`:

```typescript
if (url.pathname === '/dashboard' || url.pathname.startsWith('/dashboard.') || url.pathname.startsWith('/dashboard-')) {
  return handleDashboardFile(url.pathname)
}
```

Add the handler function:

```typescript
const DASHBOARD_DIR = new URL('.', import.meta.url).pathname

function handleDashboardFile(pathname: string): Response {
  if (pathname === '/dashboard') {
    return new Response(Bun.file(`${DASHBOARD_DIR}dashboard.html`))
  }

  const filename = pathname.slice(1) // remove leading /
  const ext = filename.split('.').pop()

  // Serve transpiled JS from cache
  if (ext === 'js') {
    const content = jsCache.get(filename)
    if (content !== undefined) {
      return new Response(content, {
        headers: { 'Content-Type': 'text/javascript' },
      })
    }
    return new Response('Not found', { status: 404 })
  }

  // Serve CSS directly from file
  if (ext === 'css') {
    const filePath = `${DASHBOARD_DIR}${filename}`
    const file = Bun.file(filePath)
    return new Response(file)
  }

  return new Response('Not found', { status: 404 })
}
```

Also update `src/index.ts` — the dynamic import call to `startDebugServer` must now `await` since it's async. Find the existing call and ensure it's awaited. It's likely already `await`ed via `import('./debug/server.js').then(m => m.startDebugServer(...))` or similar pattern — verify and adjust if needed.

**Step 3: Run tests to verify they pass**

Run: `bun test tests/debug/server.test.ts`

Expected: All tests pass, including the new CSS, JS, and 404 tests.

**Step 4: Run full checks**

Run: `bun check:full`

Expected: lint, typecheck, format all pass.

**Step 5: Commit**

```
feat(debug): serve dashboard static files with Bun.build() transpilation
```

---

### Task 3: Dashboard HTML — Full Markup

**Files:**

- Modify: `src/debug/dashboard.html`

**Step 1: Write the full HTML markup**

Replace the placeholder with the complete 4-panel structure. All dynamic elements must have `id` attributes for direct `getElementById` access in JS.

```html
<!doctype html>
<html lang="en">
  <head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1" />
    <title>papai debug</title>
    <link rel="stylesheet" href="/dashboard.css" />
  </head>
  <body>
    <header id="header">
      <div class="header-top">
        <h1>papai debug</h1>
        <span id="connection-status" class="status-dot disconnected">disconnected</span>
        <span id="uptime" class="header-stat"></span>
        <span id="stat-messages" class="header-stat"></span>
        <span id="stat-llm" class="header-stat"></span>
        <span id="stat-tools" class="header-stat"></span>
      </div>
      <div class="header-infra">
        <span id="infra-scheduler"></span>
        <span class="infra-sep"></span>
        <span id="infra-pollers"></span>
        <span class="infra-sep"></span>
        <span id="infra-msgcache"></span>
      </div>
    </header>

    <main>
      <aside id="left-panel">
        <section id="sessions">
          <h2>Sessions <span id="session-count" class="count-badge">0</span></h2>
          <div id="session-list"></div>
        </section>
        <section id="llm-trace">
          <h2>LLM Trace <span id="trace-count" class="count-badge">0</span></h2>
          <div id="trace-list"></div>
        </section>
      </aside>

      <section id="log-explorer">
        <div class="log-toolbar">
          <h2>Log Explorer <span id="log-count" class="count-badge">0</span></h2>
          <div class="log-filters">
            <select id="log-level-filter">
              <option value="0">all levels</option>
              <option value="10">debug</option>
              <option value="30">info</option>
              <option value="40">warn</option>
              <option value="50">error</option>
            </select>
            <select id="log-scope-filter">
              <option value="">all scopes</option>
            </select>
            <input id="log-search" type="text" placeholder="search..." />
            <button id="log-clear" type="button">clear</button>
          </div>
        </div>
        <div id="log-entries"></div>
        <button id="log-autoscroll" type="button" hidden>&#9660; auto-scroll</button>
      </section>
    </main>

    <script src="/dashboard-ui.js" defer></script>
    <script src="/dashboard-state.js" defer></script>
  </body>
</html>
```

**Step 2: Run server tests**

Run: `bun test tests/debug/server.test.ts`

Expected: All tests pass — the HTML content check `toContain('<html')` and `toContain('papai debug')` both match.

**Step 3: Commit**

```
feat(debug): add full dashboard HTML markup
```

---

### Task 4: Dashboard CSS — Theme and Layout

**Files:**

- Modify: `src/debug/dashboard.css`

**Step 1: Write the complete CSS**

Replace the placeholder CSS with the full terminal/hacker theme and 4-panel grid layout. Reference the design doc section "Visual Theme" and "Layout" for exact values.

Key sections to implement:

1. **Reset and base styles** — `*` box-sizing, body background/color/font
2. **Header** — sticky top, two rows (header-top, header-infra), flex layout
3. **Main grid** — `display: grid; grid-template-columns: 300px 1fr; height: calc(100vh - header-height)`
4. **Left panel** — flex-column, sessions (flex: 0 auto) and llm-trace (flex: 1, overflow-y auto)
5. **Session cards** — border-left indicator (green active, dim idle), compact layout
6. **LLM trace rows** — collapsed/expanded states, error highlight (red border-left)
7. **Log explorer** — flex-column, toolbar (flex: 0), entries (flex: 1, overflow-y auto, monospace)
8. **Log entries** — colored by level class (.log-debug, .log-info, .log-warn, .log-error), alternating row tint
9. **Auto-scroll button** — positioned absolute bottom-right of log-explorer
10. **Status dot** — green pulse animation when connected, red static when disconnected
11. **Inputs/selects** — dark background, green focus border
12. **Count badges** — dim inline counters

Color values from design:

- Background: `#0a0a0a`, Panel: `#111111`, Border: `#222222`
- Text: `#cccccc`, Secondary: `#666666`, Accent: `#00ff88`
- Log debug: `#555555`, info: `#00ff88`, warn: `#ffaa00`, error: `#ff4444`
- Font: `'JetBrains Mono', 'Fira Code', 'Cascadia Code', monospace`, size: `12px`

```css
* {
  margin: 0;
  padding: 0;
  box-sizing: border-box;
}

body {
  background: #0a0a0a;
  color: #cccccc;
  font-family: 'JetBrains Mono', 'Fira Code', 'Cascadia Code', monospace;
  font-size: 12px;
  height: 100vh;
  overflow: hidden;
  display: flex;
  flex-direction: column;
}

/* --- Header --- */

header {
  background: #111111;
  border-bottom: 1px solid #222222;
  padding: 8px 16px;
  flex: 0 0 auto;
}

.header-top {
  display: flex;
  align-items: center;
  gap: 16px;
  margin-bottom: 4px;
}

.header-top h1 {
  font-size: 14px;
  font-weight: 600;
  color: #00ff88;
}

.header-stat {
  color: #666666;
}

.status-dot {
  font-size: 11px;
}

.status-dot.connected {
  color: #00ff88;
  animation: pulse 2s ease-in-out infinite;
}

.status-dot.disconnected {
  color: #ff4444;
}

@keyframes pulse {
  0%,
  100% {
    opacity: 1;
  }
  50% {
    opacity: 0.4;
  }
}

.header-infra {
  display: flex;
  align-items: center;
  gap: 12px;
  color: #555555;
  font-size: 11px;
}

.infra-sep {
  width: 1px;
  height: 12px;
  background: #333333;
}

/* --- Main grid --- */

main {
  flex: 1;
  display: grid;
  grid-template-columns: 300px 1fr;
  min-height: 0;
}

/* --- Left panel --- */

#left-panel {
  display: flex;
  flex-direction: column;
  border-right: 1px solid #222222;
  min-height: 0;
}

#sessions {
  flex: 0 0 auto;
  max-height: 40%;
  overflow-y: auto;
  border-bottom: 1px solid #222222;
  padding: 8px;
}

#llm-trace {
  flex: 1;
  overflow-y: auto;
  padding: 8px;
  min-height: 0;
}

#sessions h2,
#llm-trace h2 {
  font-size: 11px;
  font-weight: 600;
  text-transform: uppercase;
  color: #666666;
  margin-bottom: 8px;
  letter-spacing: 0.05em;
}

.count-badge {
  color: #555555;
  font-weight: 400;
}

/* --- Session cards --- */

.session-card {
  border-left: 2px solid #333333;
  padding: 6px 8px;
  margin-bottom: 6px;
  font-size: 11px;
  line-height: 1.5;
}

.session-card.active {
  border-left-color: #00ff88;
}

.session-card .user-id {
  color: #cccccc;
  font-weight: 600;
}

.session-card .session-detail {
  color: #555555;
}

.session-card .wizard-badge {
  color: #ffaa00;
  font-size: 10px;
}

/* --- LLM trace rows --- */

.trace-row {
  border-left: 2px solid #333333;
  padding: 6px 8px;
  margin-bottom: 4px;
  cursor: pointer;
  font-size: 11px;
  line-height: 1.4;
}

.trace-row:hover {
  background: #1a1a1a;
}

.trace-row.error {
  border-left-color: #ff4444;
}

.trace-summary {
  display: flex;
  flex-wrap: wrap;
  gap: 8px;
  color: #888888;
}

.trace-summary .trace-time {
  color: #666666;
}

.trace-summary .trace-user {
  color: #cccccc;
}

.trace-summary .trace-model {
  color: #00ff88;
}

.trace-summary .trace-duration {
  color: #ffaa00;
}

.trace-detail {
  display: none;
  margin-top: 6px;
  padding: 6px;
  background: #1a1a1a;
  border-radius: 2px;
}

.trace-row[data-expanded='true'] .trace-detail {
  display: block;
}

.trace-tool {
  display: flex;
  justify-content: space-between;
  padding: 2px 0;
  color: #888888;
}

.trace-tool .tool-success {
  color: #00ff88;
}

.trace-tool .tool-fail {
  color: #ff4444;
}

.trace-tokens {
  margin-top: 4px;
  padding-top: 4px;
  border-top: 1px solid #333333;
  color: #666666;
}

.trace-error-msg {
  color: #ff4444;
  margin-top: 4px;
}

/* --- Log Explorer --- */

#log-explorer {
  display: flex;
  flex-direction: column;
  min-height: 0;
  position: relative;
}

.log-toolbar {
  flex: 0 0 auto;
  padding: 8px;
  border-bottom: 1px solid #222222;
  display: flex;
  align-items: center;
  gap: 8px;
  flex-wrap: wrap;
}

.log-toolbar h2 {
  font-size: 11px;
  font-weight: 600;
  text-transform: uppercase;
  color: #666666;
  letter-spacing: 0.05em;
  margin-right: 8px;
}

.log-filters {
  display: flex;
  gap: 6px;
  align-items: center;
}

.log-filters select,
.log-filters input,
.log-filters button {
  background: #1a1a1a;
  color: #cccccc;
  border: 1px solid #333333;
  padding: 3px 6px;
  font-family: inherit;
  font-size: 11px;
  border-radius: 2px;
}

.log-filters select:focus,
.log-filters input:focus {
  border-color: #00ff88;
  outline: none;
}

.log-filters button {
  cursor: pointer;
}

.log-filters button:hover {
  background: #222222;
}

#log-entries {
  flex: 1;
  overflow-y: auto;
  padding: 4px 0;
  min-height: 0;
}

.log-entry {
  padding: 2px 8px;
  font-size: 11px;
  line-height: 1.4;
}

.log-entry:nth-child(even) {
  background: #131313;
}

.log-entry .log-meta {
  display: inline;
}

.log-entry .log-msg {
  padding-left: 16px;
  display: block;
  word-break: break-all;
}

.log-debug .log-meta {
  color: #555555;
}
.log-debug .log-msg {
  color: #555555;
}

.log-info .log-meta {
  color: #00ff88;
}
.log-info .log-msg {
  color: #cccccc;
}

.log-warn .log-meta {
  color: #ffaa00;
}
.log-warn .log-msg {
  color: #cccccc;
}

.log-error .log-meta {
  color: #ff4444;
}
.log-error .log-msg {
  color: #cccccc;
}

#log-autoscroll {
  position: absolute;
  bottom: 8px;
  right: 8px;
  background: #1a1a1a;
  color: #00ff88;
  border: 1px solid #333333;
  padding: 4px 8px;
  font-family: inherit;
  font-size: 11px;
  cursor: pointer;
  border-radius: 2px;
  z-index: 10;
}

#log-autoscroll:hover {
  background: #222222;
}
```

**Step 2: Run server tests**

Run: `bun test tests/debug/server.test.ts`

Expected: All tests pass — the CSS content check `toContain('#log-explorer')` matches.

**Step 3: Commit**

```
feat(debug): add dashboard CSS with terminal/hacker theme
```

---

### Task 5: Dashboard UI — Render Functions

**Files:**

- Modify: `src/debug/dashboard-ui.ts`

**Step 1: Write the render functions**

Replace the placeholder with all render functions exposed on `window`. This file loads first (via `<script defer>` order in HTML). It defines render functions that `dashboard-state.ts` calls after state mutations.

Important: These files are client-side TypeScript transpiled by `Bun.build()`. They use DOM APIs, so they need `/// <reference lib="dom" />`. Since oxlint enforces strict rules (explicit return types, no-explicit-any, etc.) that don't apply well to browser JS, the dashboard `.ts` files should be excluded from linting via an override in `.oxlintrc.json`.

Add this override to `.oxlintrc.json` in the `overrides` array:

```json
{
  "files": ["src/debug/dashboard-*.ts"],
  "rules": {
    "max-lines": "off",
    "max-lines-per-function": "off",
    "typescript/explicit-function-return-type": "off",
    "typescript/explicit-module-boundary-types": "off"
  }
}
```

Now write `dashboard-ui.ts`:

```typescript
/// <reference lib="dom" />

// --- DOM elements ---
const $connStatus = document.getElementById('connection-status')!
const $uptime = document.getElementById('uptime')!
const $statMessages = document.getElementById('stat-messages')!
const $statLlm = document.getElementById('stat-llm')!
const $statTools = document.getElementById('stat-tools')!
const $infraScheduler = document.getElementById('infra-scheduler')!
const $infraPollers = document.getElementById('infra-pollers')!
const $infraMsgcache = document.getElementById('infra-msgcache')!
const $sessionCount = document.getElementById('session-count')!
const $sessionList = document.getElementById('session-list')!
const $traceCount = document.getElementById('trace-count')!
const $traceList = document.getElementById('trace-list')!
const $logCount = document.getElementById('log-count')!
const $logEntries = document.getElementById('log-entries')!
const $logLevelFilter = document.getElementById('log-level-filter') as HTMLSelectElement
const $logScopeFilter = document.getElementById('log-scope-filter') as HTMLSelectElement
const $logSearch = document.getElementById('log-search') as HTMLInputElement
const $logClear = document.getElementById('log-clear')!
const $logAutoscroll = document.getElementById('log-autoscroll')!

// --- Auto-scroll state ---
let autoScroll = true

$logEntries.addEventListener('scroll', () => {
  const { scrollTop, scrollHeight, clientHeight } = $logEntries
  autoScroll = scrollHeight - scrollTop - clientHeight < 50
  ;($logAutoscroll as HTMLElement).hidden = autoScroll
})

$logAutoscroll.addEventListener('click', () => {
  autoScroll = true
  ;($logAutoscroll as HTMLElement).hidden = true
  $logEntries.scrollTop = $logEntries.scrollHeight
})

// --- Filter event listeners ---
$logLevelFilter.addEventListener('change', () => (window as any).renderLogs())
$logScopeFilter.addEventListener('change', () => (window as any).renderLogs())
$logSearch.addEventListener('input', () => (window as any).renderLogs())
$logClear.addEventListener('click', () => (window as any).clearLogs())

// --- Trace expand/collapse via event delegation ---
$traceList.addEventListener('click', (e: Event) => {
  const target = e.target as HTMLElement
  const row = target.closest('.trace-row') as HTMLElement | null
  if (row === null) return
  const expanded = row.getAttribute('data-expanded') === 'true'
  row.setAttribute('data-expanded', expanded ? 'false' : 'true')
})

// --- Helper functions ---

const LEVEL_NAMES: Record<number, string> = {
  10: 'trace',
  20: 'debug',
  30: 'info',
  40: 'warn',
  50: 'error',
  60: 'fatal',
}

function levelName(level: number): string {
  return LEVEL_NAMES[level] ?? `L${level}`
}

function levelClass(level: number): string {
  if (level >= 50) return 'log-error'
  if (level >= 40) return 'log-warn'
  if (level >= 30) return 'log-info'
  return 'log-debug'
}

function formatTime(ts: number | string): string {
  const d = typeof ts === 'string' ? new Date(ts) : new Date(ts)
  return d.toLocaleTimeString('en-GB', {
    hour12: false,
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    fractionalSecondDigits: 3,
  })
}

function formatUptime(startedAt: number): string {
  const ms = Date.now() - startedAt
  const s = Math.floor(ms / 1000)
  const h = Math.floor(s / 3600)
  const m = Math.floor((s % 3600) / 60)
  if (h > 0) return `${h}h${m}m`
  return `${m}m${s % 60}s`
}

function formatTokens(n: number): string {
  if (n >= 1000) return `${(n / 1000).toFixed(1)}k`
  return String(n)
}

function escapeHtml(str: string): string {
  return str.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;')
}

// --- Render functions exposed on window ---

;(window as any).renderConnection = (connected: boolean) => {
  $connStatus.textContent = connected ? '\u25cf connected' : '\u25cf disconnected'
  $connStatus.className = `status-dot ${connected ? 'connected' : 'disconnected'}`
}
;(window as any).renderStats = (stats: any) => {
  $uptime.textContent = `uptime ${formatUptime(stats.startedAt)}`
  $statMessages.textContent = `msgs: ${stats.totalMessages}`
  $statLlm.textContent = `llm: ${stats.totalLlmCalls}`
  $statTools.textContent = `tools: ${stats.totalToolCalls}`
}
;(window as any).renderInfra = (scheduler: any, pollers: any, messageCache: any) => {
  const sched = scheduler ?? {}
  $infraScheduler.textContent = `scheduler: ${sched.running ? 'running' : 'stopped'}${sched.tickCount !== undefined ? ` (tick #${sched.tickCount})` : ''}`

  const poll = pollers ?? {}
  const sDot = poll.scheduledRunning ? '\u25cf' : '\u25cb'
  const aDot = poll.alertsRunning ? '\u25cf' : '\u25cb'
  $infraPollers.textContent = `pollers: scheduled ${sDot}  alerts ${aDot}`

  const mc = messageCache ?? {}
  $infraMsgcache.textContent = `msg-cache: ${mc.size ?? 0} entries, ${mc.pendingWrites ?? 0} pending`
}
;(window as any).renderSessions = (sessions: Map<string, any>, wizards: Map<string, any>) => {
  $sessionCount.textContent = String(sessions.size)
  let html = ''
  for (const [userId, s] of sessions) {
    const wiz = wizards.get(userId)
    const isActive = Date.now() - s.lastAccessed < 300000 // 5 min
    html += `<div class="session-card ${isActive ? 'active' : ''}">`
    html += `<div class="user-id">${escapeHtml(userId)}</div>`
    html += `<div class="session-detail">history: ${s.historyLength} &middot; facts: ${s.factsCount} &middot; summary: ${s.summary !== null ? 'yes' : 'no'}</div>`
    if (s.configKeys?.length > 0) {
      html += `<div class="session-detail">config: ${s.configKeys.length} keys</div>`
    }
    if (s.workspaceId !== null && s.workspaceId !== undefined) {
      html += `<div class="session-detail">workspace: ${escapeHtml(String(s.workspaceId))}</div>`
    }
    if (wiz !== undefined) {
      html += `<div class="wizard-badge">\uD83E\uDDD9 wizard step ${wiz.currentStep}/${wiz.totalSteps}</div>`
    }
    html += '</div>'
  }
  $sessionList.innerHTML = html
}
;(window as any).renderTraces = (traces: any[]) => {
  $traceCount.textContent = String(traces.length)
  let html = ''
  for (let i = 0; i < traces.length; i++) {
    const t = traces[i]
    const isError = t.error !== undefined && t.error !== ''
    html += `<div class="trace-row ${isError ? 'error' : ''}" data-expanded="false">`
    html += '<div class="trace-summary">'
    html += `<span class="trace-time">${formatTime(t.timestamp)}</span>`
    html += `<span class="trace-user">${escapeHtml(t.userId)}</span>`
    html += `<span class="trace-model">${escapeHtml(t.model)}</span>`
    html += `<span class="trace-duration">${(t.duration / 1000).toFixed(1)}s</span>`
    html += `<span>${t.steps} steps &middot; ${formatTokens(t.totalTokens?.inputTokens ?? 0)}\u2193</span>`
    html += '</div>'
    html += '<div class="trace-detail">'
    if (t.toolCalls?.length > 0) {
      for (const tc of t.toolCalls) {
        html += `<div class="trace-tool"><span>${escapeHtml(tc.toolName)}</span><span>${tc.durationMs}ms <span class="${tc.success ? 'tool-success' : 'tool-fail'}">${tc.success ? '\u2713' : '\u2717'}</span></span></div>`
      }
    }
    html += `<div class="trace-tokens">in: ${formatTokens(t.totalTokens?.inputTokens ?? 0)} &middot; out: ${formatTokens(t.totalTokens?.outputTokens ?? 0)}</div>`
    if (isError) {
      html += `<div class="trace-error-msg">${escapeHtml(t.error)}</div>`
    }
    html += '</div></div>'
  }
  $traceList.innerHTML = html
}
;(window as any).renderLogs = () => {
  const state = (window as any).__state
  if (state === undefined) return

  const minLevel = Number($logLevelFilter.value)
  const scope = $logScopeFilter.value
  const query = $logSearch.value.toLowerCase()

  const filtered = state.logs.filter((e: any) => {
    if (e.level < minLevel) return false
    if (scope !== '' && e.scope !== scope) return false
    if (query !== '' && !e.msg.toLowerCase().includes(query)) return false
    return true
  })

  $logCount.textContent = String(filtered.length)

  let html = ''
  for (const entry of filtered) {
    const cls = levelClass(entry.level)
    const time = formatTime(entry.time)
    const scopeStr = entry.scope !== undefined ? ` ${entry.scope}` : ''
    html += `<div class="log-entry ${cls}"><span class="log-meta">${time} ${levelName(entry.level)}${scopeStr}</span><span class="log-msg">${escapeHtml(entry.msg)}</span></div>`
  }
  $logEntries.innerHTML = html

  if (autoScroll) {
    $logEntries.scrollTop = $logEntries.scrollHeight
  }
}
;(window as any).updateScopeFilter = (scopes: Set<string>) => {
  const current = $logScopeFilter.value
  let html = '<option value="">all scopes</option>'
  for (const s of [...scopes].sort()) {
    html += `<option value="${escapeHtml(s)}"${s === current ? ' selected' : ''}>${escapeHtml(s)}</option>`
  }
  $logScopeFilter.innerHTML = html
}
```

**Step 2: Run server tests**

Run: `bun test tests/debug/server.test.ts`

Expected: All tests pass — the JS content check `toContain('getElementById')` matches.

**Step 3: Run lint and typecheck**

Run: `bun lint && bun typecheck`

Expected: Both pass. The `/// <reference lib="dom" />` directive provides DOM types. The oxlint override disables strict function return type rules for dashboard files.

**Step 4: Commit**

```
feat(debug): add dashboard UI render functions and DOM event listeners
```

---

### Task 6: Dashboard State — SSE and Event Dispatch

**Files:**

- Modify: `src/debug/dashboard-state.ts`

**Step 1: Write the state management and SSE connection logic**

Replace the placeholder with the full state object, SSE connection, event handler dispatch, and log bootstrap.

```typescript
/// <reference lib="dom" />

const LOG_CAP = 65535

const state = {
  connected: false,
  stats: { startedAt: Date.now(), totalMessages: 0, totalLlmCalls: 0, totalToolCalls: 0 },
  sessions: new Map<string, any>(),
  wizards: new Map<string, any>(),
  scheduler: {} as any,
  pollers: {} as any,
  messageCache: {} as any,
  llmTraces: [] as any[],
  logs: [] as any[],
  logScopes: new Set<string>(),
}

// Expose state for renderLogs() to access
;(window as any).__state = state

// --- Render helpers (call into dashboard-ui.ts via window) ---

function renderAll() {
  const w = window as any
  w.renderConnection(state.connected)
  w.renderStats(state.stats)
  w.renderInfra(state.scheduler, state.pollers, state.messageCache)
  w.renderSessions(state.sessions, state.wizards)
  w.renderTraces(state.llmTraces)
  w.renderLogs()
}

// --- Event handlers ---

function handleStateInit(d: any) {
  // Populate sessions map
  state.sessions.clear()
  if (Array.isArray(d.sessions)) {
    for (const s of d.sessions) state.sessions.set(s.userId, s)
  }

  // Populate wizards map
  state.wizards.clear()
  if (Array.isArray(d.wizards)) {
    for (const w of d.wizards) state.wizards.set(w.userId, w)
  }

  state.scheduler = d.scheduler ?? {}
  state.pollers = d.pollers ?? {}
  state.messageCache = d.messageCache ?? {}
  state.stats = d.stats ?? state.stats
  state.llmTraces = Array.isArray(d.recentLlm) ? [...d.recentLlm].reverse() : []

  renderAll()
}

function handleStateStats(d: any) {
  Object.assign(state.stats, d)
  const w = window as any
  w.renderStats(state.stats)
}

function handleLlmFull(d: any) {
  state.llmTraces.unshift(d)
  if (state.llmTraces.length > LOG_CAP) state.llmTraces.pop()
  ;(window as any).renderTraces(state.llmTraces)
}

function handleCacheEvent(d: any) {
  const userId = d.userId as string
  const existing = state.sessions.get(userId)
  if (existing !== undefined) {
    // Update fields based on cache event data
    if (d.field === 'history') existing.historyLength = (existing.historyLength ?? 0) + 1
    existing.lastAccessed = Date.now()
  } else {
    // New session appeared — create a minimal entry
    state.sessions.set(userId, {
      userId,
      lastAccessed: Date.now(),
      historyLength: 0,
      factsCount: 0,
      summary: null,
      configKeys: [],
      workspaceId: null,
    })
  }
  ;(window as any).renderSessions(state.sessions, state.wizards)
}

function handleCacheExpire(d: any) {
  state.sessions.delete(d.userId as string)
  state.wizards.delete(d.userId as string)
  ;(window as any).renderSessions(state.sessions, state.wizards)
}

function handleWizardCreated(d: any) {
  state.wizards.set(d.userId as string, d)
  ;(window as any).renderSessions(state.sessions, state.wizards)
}

function handleWizardUpdated(d: any) {
  const existing = state.wizards.get(d.userId as string)
  if (existing !== undefined) Object.assign(existing, d)
  else state.wizards.set(d.userId as string, d)
  ;(window as any).renderSessions(state.sessions, state.wizards)
}

function handleWizardDeleted(d: any) {
  state.wizards.delete(d.userId as string)
  ;(window as any).renderSessions(state.sessions, state.wizards)
}

function handleSchedulerTick(d: any) {
  Object.assign(state.scheduler, d)
  ;(window as any).renderInfra(state.scheduler, state.pollers, state.messageCache)
}

function handlePollerEvent(d: any) {
  Object.assign(state.pollers, d)
  ;(window as any).renderInfra(state.scheduler, state.pollers, state.messageCache)
}

function handleMsgcacheSweep(d: any) {
  Object.assign(state.messageCache, d)
  ;(window as any).renderInfra(state.scheduler, state.pollers, state.messageCache)
}

function handleLogEntry(d: any) {
  state.logs.push(d)
  if (state.logs.length > LOG_CAP) state.logs.shift()

  if (d.scope !== undefined && !state.logScopes.has(d.scope)) {
    state.logScopes.add(d.scope)
    ;(window as any).updateScopeFilter(state.logScopes)
  }

  ;(window as any).renderLogs()
}

// --- SSE event type → handler mapping ---

const handlers: Record<string, (d: any) => void> = {
  'state:init': handleStateInit,
  'state:stats': handleStateStats,
  'llm:full': handleLlmFull,
  'cache:load': handleCacheEvent,
  'cache:sync': handleCacheEvent,
  'cache:expire': handleCacheExpire,
  'wizard:created': handleWizardCreated,
  'wizard:updated': handleWizardUpdated,
  'wizard:deleted': handleWizardDeleted,
  'scheduler:tick': handleSchedulerTick,
  'poller:scheduled': handlePollerEvent,
  'poller:alerts': handlePollerEvent,
  'msgcache:sweep': handleMsgcacheSweep,
  'log:entry': handleLogEntry,
}

// --- Clear logs (called from UI) ---

;(window as any).clearLogs = () => {
  state.logs.length = 0
  state.logScopes.clear()
  ;(window as any).updateScopeFilter(state.logScopes)
  ;(window as any).renderLogs()
}

// --- Uptime ticker ---

setInterval(() => {
  if (state.connected) (window as any).renderStats(state.stats)
}, 10000)

// --- Initialize ---

async function init() {
  // Bootstrap logs from server ring buffer
  try {
    const res = await fetch('/logs')
    if (res.ok) {
      const logs = await res.json()
      if (Array.isArray(logs)) {
        state.logs = logs
        for (const entry of logs) {
          if (entry.scope !== undefined) state.logScopes.add(entry.scope)
        }
        ;(window as any).updateScopeFilter(state.logScopes)
        ;(window as any).renderLogs()
      }
    }
  } catch {
    // Log bootstrap failed — will populate from SSE events
  }

  // Connect SSE
  const evtSource = new EventSource('/events')

  evtSource.addEventListener('open', () => {
    state.connected = true
    ;(window as any).renderConnection(true)
  })

  evtSource.addEventListener('error', () => {
    state.connected = false
    ;(window as any).renderConnection(false)
  })

  // Register handler for each event type
  for (const [type, handler] of Object.entries(handlers)) {
    evtSource.addEventListener(type, (e: Event) => {
      const me = e as MessageEvent
      try {
        const parsed = JSON.parse(me.data)
        handler(parsed.data ?? parsed)
      } catch {
        // Skip malformed events
      }
    })
  }
}

init()
```

**Step 2: Run server tests**

Run: `bun test tests/debug/server.test.ts`

Expected: All tests pass — the JS content check `toContain('EventSource')` matches.

**Step 3: Run lint, typecheck, and format**

Run: `bun check:full`

Expected: All checks pass.

**Step 4: Commit**

```
feat(debug): add dashboard state management and SSE event dispatch
```

---

### Task 7: Lint Config — Disable Strict Rules for Dashboard Files

**Files:**

- Modify: `.oxlintrc.json`

This task may have been partially done in Task 5 — verify and finalize.

**Step 1: Add override for dashboard client-side TS files**

Add this entry to the `overrides` array in `.oxlintrc.json` (after the test override, before the docs override):

```json
{
  "files": ["src/debug/dashboard-*.ts"],
  "rules": {
    "max-lines": "off",
    "max-lines-per-function": "off",
    "typescript/explicit-function-return-type": "off",
    "typescript/explicit-module-boundary-types": "off",
    "typescript/no-explicit-any": "off",
    "typescript/no-unsafe-type-assertion": "off",
    "no-param-reassign": "off"
  }
}
```

**Step 2: Run lint**

Run: `bun lint`

Expected: No lint errors from dashboard files.

**Step 3: Commit**

```
chore(lint): disable strict rules for dashboard client-side TS files
```

---

### Task 8: Final Integration Verification

**Step 1: Run full test suite**

Run: `bun test`

Expected: All tests pass, including the updated server tests.

**Step 2: Run all checks**

Run: `bun check:verbose`

Expected: lint, typecheck, format, knip, test, duplicates, mock-pollution all pass.

**Step 3: Manual verification**

Run: `DEBUG_SERVER=true bun start`

Open `http://localhost:9100/dashboard` in a browser.

Verify:

- [ ] Page loads with dark terminal theme
- [ ] Header shows connection status (green dot + "connected")
- [ ] Header shows uptime and stats counters
- [ ] Header shows infrastructure indicators (scheduler, pollers, msg-cache)
- [ ] Sessions panel shows active user sessions (if any)
- [ ] LLM Trace panel shows recent traces (send a message to the bot to generate one)
- [ ] Clicking a trace row expands to show tool calls and token details
- [ ] Log Explorer streams log entries in real-time
- [ ] Level dropdown filters log entries
- [ ] Scope dropdown populates with seen scopes and filters
- [ ] Search input filters log messages
- [ ] Clear button empties the log view
- [ ] Scrolling up disengages auto-scroll and shows the "auto-scroll" button
- [ ] Clicking "auto-scroll" re-engages and scrolls to bottom

**Step 4: Commit any fixes**

If manual testing reveals issues, fix and commit with descriptive messages.

**Step 5: Final commit**

```
feat(debug): complete Session 4 — dashboard HTML with live debug panels
```

---

Plan complete and saved to `docs/plans/2026-03-29-debug-session4-dashboard-html-implementation.md`. Two execution options:

**1. Subagent-Driven (this session)** - I dispatch fresh subagent per task, review between tasks, fast iteration

**2. Parallel Session (separate)** - Open new session with executing-plans, batch execution with checkpoints

Which approach?
