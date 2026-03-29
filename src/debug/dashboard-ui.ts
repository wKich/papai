/// <reference lib="dom" />
import './dashboard-types.js'
import type { LogEntry } from './schemas.js'

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
const $logLevelFilter = document.querySelector<HTMLSelectElement>('#log-level-filter')!
const $logScopeFilter = document.querySelector<HTMLSelectElement>('#log-scope-filter')!
const $logSearch = document.querySelector<HTMLInputElement>('#log-search')!
const $logClear = document.getElementById('log-clear')!
const $logAutoscroll = document.getElementById('log-autoscroll')!

// --- Auto-scroll state ---
let autoScroll = true

$logEntries.addEventListener('scroll', () => {
  const { scrollTop, scrollHeight, clientHeight } = $logEntries
  autoScroll = scrollHeight - scrollTop - clientHeight < 50
  $logAutoscroll.hidden = autoScroll
})

$logAutoscroll.addEventListener('click', () => {
  autoScroll = true
  $logAutoscroll.hidden = true
  $logEntries.scrollTop = $logEntries.scrollHeight
})

// --- Filter event listeners ---
$logLevelFilter.addEventListener('change', () => {
  window.dashboard.renderLogs()
})
$logScopeFilter.addEventListener('change', () => {
  window.dashboard.renderLogs()
})
$logSearch.addEventListener('input', () => {
  window.dashboard.renderLogs()
})
$logClear.addEventListener('click', () => {
  window.dashboard.clearLogs()
})

// --- Trace expand/collapse via event delegation ---
$traceList.addEventListener('click', (e: Event) => {
  const target = e.target
  if (!(target instanceof HTMLElement)) return
  const row = target.closest('.trace-row')
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

window.dashboard.renderConnection = (connected: boolean): void => {
  $connStatus.textContent = connected ? '\u25cf connected' : '\u25cf disconnected'
  $connStatus.className = `status-dot ${connected ? 'connected' : 'disconnected'}`
}
window.dashboard.renderStats = (stats): void => {
  $uptime.textContent = `uptime ${formatUptime(stats.startedAt)}`
  $statMessages.textContent = `msgs: ${stats.totalMessages}`
  $statLlm.textContent = `llm: ${stats.totalLlmCalls}`
  $statTools.textContent = `tools: ${stats.totalToolCalls}`
}
window.dashboard.renderInfra = (scheduler, pollers, messageCache): void => {
  const sched = scheduler ?? {}
  const isRunning = sched.running !== undefined && sched.running
  const tickPart = sched.tickCount === undefined ? '' : ` (tick #${sched.tickCount})`
  $infraScheduler.textContent = `scheduler: ${isRunning ? 'running' : 'stopped'}${tickPart}`

  const poll = pollers ?? {}
  const sDot = poll.scheduledRunning !== undefined && poll.scheduledRunning ? '\u25cf' : '\u25cb'
  const aDot = poll.alertsRunning !== undefined && poll.alertsRunning ? '\u25cf' : '\u25cb'
  $infraPollers.textContent = `pollers: scheduled ${sDot}  alerts ${aDot}`

  const mc = messageCache ?? {}
  $infraMsgcache.textContent = `msg-cache: ${mc.size ?? 0} entries, ${mc.pendingWrites ?? 0} pending`
}
window.dashboard.renderSessions = (sessions, wizards): void => {
  $sessionCount.textContent = String(sessions.size)
  let html = ''
  for (const [userId, s] of sessions) {
    const wiz = wizards.get(userId)
    const isActive = Date.now() - s.lastAccessed < 300000
    html += `<div class="session-card ${isActive ? 'active' : ''}">`
    html += `<div class="user-id">${escapeHtml(userId)}</div>`
    html += `<div class="session-detail">history: ${s.historyLength} &middot; facts: ${s.factsCount} &middot; summary: ${s.summary === null ? 'no' : 'yes'}</div>`
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
window.dashboard.renderTraces = (traces): void => {
  $traceCount.textContent = String(traces.length)
  let html = ''
  for (const t of traces) {
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
    if (t.toolCalls !== undefined && t.toolCalls.length > 0) {
      for (const tc of t.toolCalls) {
        html += `<div class="trace-tool"><span>${escapeHtml(tc.toolName)}</span><span>${tc.durationMs}ms <span class="${tc.success ? 'tool-success' : 'tool-fail'}">${tc.success ? '\u2713' : '\u2717'}</span></span></div>`
      }
    }
    html += `<div class="trace-tokens">in: ${formatTokens(t.totalTokens?.inputTokens ?? 0)} &middot; out: ${formatTokens(t.totalTokens?.outputTokens ?? 0)}</div>`
    if (isError && t.error !== undefined) {
      html += `<div class="trace-error-msg">${escapeHtml(t.error)}</div>`
    }
    html += '</div></div>'
  }
  $traceList.innerHTML = html
}
window.dashboard.renderLogs = (): void => {
  const state = window.dashboard.__state
  if (state === undefined) return

  const minLevel = Number($logLevelFilter.value)
  const scope = $logScopeFilter.value
  const query = $logSearch.value.toLowerCase()

  const filtered = state.logs.filter((e: LogEntry) => {
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
    const scopeStr = entry.scope === undefined ? '' : ` ${entry.scope}`
    html += `<div class="log-entry ${cls}"><span class="log-meta">${time} ${levelName(entry.level)}${scopeStr}</span><span class="log-msg">${escapeHtml(entry.msg)}</span></div>`
  }
  $logEntries.innerHTML = html

  if (autoScroll) {
    $logEntries.scrollTop = $logEntries.scrollHeight
  }
}
window.dashboard.updateScopeFilter = (scopes): void => {
  const current = $logScopeFilter.value
  let html = '<option value="">all scopes</option>'
  for (const s of [...scopes].sort()) {
    html += `<option value="${escapeHtml(s)}"${s === current ? ' selected' : ''}>${escapeHtml(s)}</option>`
  }
  $logScopeFilter.innerHTML = html
}
