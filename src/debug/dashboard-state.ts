/// <reference lib="dom" />
import type { DashboardState } from './dashboard-types.js'

const LOG_CAP = 65535

const state: DashboardState = {
  connected: false,
  stats: { startedAt: Date.now(), totalMessages: 0, totalLlmCalls: 0, totalToolCalls: 0 },
  sessions: new Map(),
  wizards: new Map(),
  scheduler: {},
  pollers: {},
  messageCache: {},
  llmTraces: [],
  logs: [],
  logScopes: new Set(),
}

// Expose state for renderLogs() to access
window.dashboard.__state = state

// --- Render helpers (call into dashboard-ui.ts via window) ---

function renderAll() {
  const dash = window.dashboard
  dash.renderConnection(state.connected)
  dash.renderStats(state.stats)
  dash.renderInfra(state.scheduler, state.pollers, state.messageCache)
  dash.renderSessions(state.sessions, state.wizards)
  dash.renderTraces(state.llmTraces)
  dash.renderLogs()
}

// --- Event handlers ---

function handleStateInit(d: any) {
  state.sessions.clear()
  if (Array.isArray(d.sessions)) {
    for (const s of d.sessions) state.sessions.set(s.userId, s)
  }

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
  const dash = window.dashboard
  dash.renderStats(state.stats)
}

function handleLlmFull(d: any) {
  state.llmTraces.unshift(d)
  if (state.llmTraces.length > LOG_CAP) state.llmTraces.pop()
  scheduleTracesRender()
}

function handleCacheEvent(d: any) {
  const userId = d.userId as string
  const existing = state.sessions.get(userId)
  if (existing !== undefined) {
    if (d.field === 'history') existing.historyLength = (existing.historyLength ?? 0) + 1
    existing.lastAccessed = Date.now()
  } else {
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
  scheduleSessionsRender()
}

function handleCacheExpire(d: any) {
  state.sessions.delete(d.userId as string)
  state.wizards.delete(d.userId as string)
  scheduleSessionsRender()
}

function handleWizardCreated(d: any) {
  state.wizards.set(d.userId as string, d)
  scheduleSessionsRender()
}

function handleWizardUpdated(d: any) {
  const existing = state.wizards.get(d.userId as string)
  if (existing !== undefined) Object.assign(existing, d)
  else state.wizards.set(d.userId as string, d)
  scheduleSessionsRender()
}

function handleWizardDeleted(d: any) {
  state.wizards.delete(d.userId as string)
  scheduleSessionsRender()
}

function handleSchedulerTick(d: any) {
  Object.assign(state.scheduler, d)
  window.dashboard.renderInfra(state.scheduler, state.pollers, state.messageCache)
}

function handlePollerEvent(d: any) {
  Object.assign(state.pollers, d)
  window.dashboard.renderInfra(state.scheduler, state.pollers, state.messageCache)
}

function handleMsgcacheSweep(d: any) {
  Object.assign(state.messageCache, d)
  window.dashboard.renderInfra(state.scheduler, state.pollers, state.messageCache)
}

let logRenderPending = false

function scheduleLogRender() {
  if (!logRenderPending) {
    logRenderPending = true
    requestAnimationFrame(() => {
      logRenderPending = false
      window.dashboard.renderLogs()
    })
  }
}

let sessionsRenderPending = false

function scheduleSessionsRender() {
  if (!sessionsRenderPending) {
    sessionsRenderPending = true
    requestAnimationFrame(() => {
      sessionsRenderPending = false
      window.dashboard.renderSessions(state.sessions, state.wizards)
    })
  }
}

let tracesRenderPending = false

function scheduleTracesRender() {
  if (!tracesRenderPending) {
    tracesRenderPending = true
    requestAnimationFrame(() => {
      tracesRenderPending = false
      window.dashboard.renderTraces(state.llmTraces)
    })
  }
}

function handleLogEntry(d: any) {
  state.logs.push(d)
  if (state.logs.length > LOG_CAP) state.logs.shift()

  if (d.scope !== undefined && !state.logScopes.has(d.scope)) {
    state.logScopes.add(d.scope)
    window.dashboard.updateScopeFilter(state.logScopes)
  }

  scheduleLogRender()
}

// --- SSE event type -> handler mapping ---

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

window.dashboard.clearLogs = () => {
  state.logs.length = 0
  state.logScopes.clear()
  window.dashboard.updateScopeFilter(state.logScopes)
  window.dashboard.renderLogs()
}

// --- Uptime ticker ---

setInterval(() => {
  if (state.connected) window.dashboard.renderStats(state.stats)
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
        window.dashboard.updateScopeFilter(state.logScopes)
        window.dashboard.renderLogs()
      }
    }
  } catch {
    // Log bootstrap failed — will populate from SSE events
  }

  // Connect SSE
  const evtSource = new EventSource('/events')

  evtSource.addEventListener('open', () => {
    state.connected = true
    window.dashboard.renderConnection(true)
  })

  evtSource.addEventListener('error', () => {
    state.connected = false
    window.dashboard.renderConnection(false)
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
