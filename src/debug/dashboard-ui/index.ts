/// <reference lib="dom" />
import type { DashboardAPI } from '../dashboard-types.js'
import { renderPropertiesTree } from '../dashboard/tree-view.js'
import type { LogEntry } from '../schemas.js'
import { escapeHtml, formatTime, formatTokens, formatUptime, levelClass, levelName } from './helpers.js'
import { filterLogs, getLogFilterElements, getLogModalElements, renderLogEntry, updateFuseIndex } from './logs.js'
import { getSessionModalElements, renderSessionDetail } from './session-detail.js'
import { buildTraceDetail } from './traces.js'
import type { SessionDetail } from './types.js'

// Build dashboard API object with stub implementations
const dashboard: DashboardAPI = {
  renderConnection: () => {},
  renderStats: () => {},
  renderInfra: () => {},
  renderSessions: () => {},
  renderTraces: () => {},
  renderLogs: () => {},
  updateScopeFilter: () => {},
  clearLogs: () => {},
  __state: {
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
  },
}

// Assign to window if not already present
if (typeof window.dashboard === 'undefined') {
  window.dashboard = dashboard
}

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

const logElements = getLogFilterElements()
const sessionElements = getSessionModalElements()
const logModalElements = getLogModalElements()

// --- Auto-scroll state ---
let autoScroll = true

$logEntries.addEventListener('scroll', () => {
  const { scrollTop, scrollHeight, clientHeight } = $logEntries
  autoScroll = scrollHeight - scrollTop - clientHeight < 50
  logElements.$logAutoscroll.hidden = autoScroll
})

logElements.$logAutoscroll.addEventListener('click', () => {
  autoScroll = true
  logElements.$logAutoscroll.hidden = true
  $logEntries.scrollTop = $logEntries.scrollHeight
})

// --- Filter event listeners ---
logElements.$logLevelFilter.addEventListener('change', () => {
  window.dashboard.renderLogs()
})
logElements.$logScopeFilter.addEventListener('change', () => {
  window.dashboard.renderLogs()
})
logElements.$logSearch.addEventListener('input', () => {
  window.dashboard.renderLogs()
})
logElements.$logClear.addEventListener('click', () => {
  window.dashboard.clearLogs()
})

// --- Modal event listeners ---
sessionElements.$sessionModalClose.addEventListener('click', () => {
  sessionElements.$sessionModal.hidden = true
})
sessionElements.$sessionModal.addEventListener('click', (e) => {
  if (e.target === sessionElements.$sessionModal) sessionElements.$sessionModal.hidden = true
})
logModalElements.$logModalClose.addEventListener('click', () => {
  logModalElements.$logModal.hidden = true
})
logModalElements.$logModal.addEventListener('click', (e) => {
  if (e.target === logModalElements.$logModal) logModalElements.$logModal.hidden = true
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

function buildSessionCard(
  userId: string,
  s: SessionDetail,
  wizards: Map<string, { currentStep: number | string; totalSteps: number | string }>,
): string {
  const wiz = wizards.get(userId)
  const isActive = Date.now() - s.lastAccessed < 300000
  let html = `<div class="session-card ${isActive ? 'active' : ''}" data-userid="${escapeHtml(userId)}">`
  html += `<div class="user-id">${escapeHtml(userId)}</div>`
  html += `<div class="session-detail">history: ${s.historyLength} \u00b7 facts: ${s.factsCount} \u00b7 summary: ${s.summary === null ? 'no' : 'yes'}</div>`
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
  return html
}

window.dashboard.renderSessions = (sessions, wizards): void => {
  $sessionCount.textContent = String(sessions.size)
  let html = ''
  for (const [userId, s] of sessions) {
    html += buildSessionCard(userId, s as SessionDetail, wizards)
  }
  $sessionList.innerHTML = html

  // Add click handlers to session cards
  for (const card of $sessionList.querySelectorAll('.session-card')) {
    card.addEventListener('click', () => {
      const userId = card.getAttribute('data-userid')
      if (userId !== null) {
        const session = sessions.get(userId)
        if (session !== undefined) {
          renderSessionDetail(userId, session as SessionDetail, sessionElements)
        }
      }
    })
  }
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
    html += `<span>${t.steps} steps \u00b7 ${formatTokens(t.totalTokens?.inputTokens ?? 0)}\u2193</span>`
    html += '</div>'
    html += buildTraceDetail(t)
    html += '</div>'
  }
  $traceList.innerHTML = html
}

function renderLogDetail(entry: LogEntry, index: number): void {
  logModalElements.$logModalTitle.textContent = `Log Entry #${index + 1}`

  let html = '<div class="log-detail-meta">'
  html += `<div class="log-detail-meta-item"><div class="label">Time</div><div class="value">${formatTime(entry.time)}</div></div>`
  html += `<div class="log-detail-meta-item"><div class="label">Level</div><div class="value ${levelClass(entry.level)}">${levelName(entry.level)} (${entry.level})</div></div>`
  const scopeValue = entry.scope === undefined ? 'none' : escapeHtml(entry.scope)
  html += `<div class="log-detail-meta-item"><div class="label">Scope</div><div class="value">${scopeValue}</div></div>`
  html += '</div>'

  html += '<div class="log-detail-section">'
  html += '<h4>Message</h4>'
  html += `<pre style="background:#131313;padding:12px;border-radius:2px;white-space:pre-wrap;word-break:break-word;font-size:11px;color:#cccccc;">${escapeHtml(entry.msg)}</pre>`
  html += '</div>'

  const standardFields = new Set(['time', 'level', 'msg', 'scope'])
  const extraProps: Record<string, unknown> = {}
  for (const [key, value] of Object.entries(entry)) {
    if (!standardFields.has(key)) {
      extraProps[key] = value
    }
  }

  if (Object.keys(extraProps).length > 0) {
    html += '<div class="log-detail-section">'
    html += '<h4>Properties</h4>'
    html += renderPropertiesTree(extraProps)
    html += '</div>'
  }

  logModalElements.$logModalBody.innerHTML = html
  logModalElements.$logModal.hidden = false
}

let fuseInstance: ReturnType<typeof updateFuseIndex> = null

window.dashboard.renderLogs = (): void => {
  const state = window.dashboard.__state
  if (state === undefined) return

  const minLevel = Number(logElements.$logLevelFilter.value)
  const scope = logElements.$logScopeFilter.value
  const query = logElements.$logSearch.value.trim()

  fuseInstance = updateFuseIndex(state.logs)
  const filtered = filterLogs(state.logs, minLevel, scope, query, fuseInstance)

  $logCount.textContent = String(filtered.length)

  let html = ''
  for (const entry of filtered) {
    html += renderLogEntry(entry)
  }
  $logEntries.innerHTML = html

  // Add click handlers to log entries
  const entries = $logEntries.querySelectorAll('.log-entry')
  for (let i = 0; i < entries.length; i++) {
    const entryEl = entries[i]
    if (entryEl === undefined) continue
    const filteredEntry = filtered[i]
    if (filteredEntry === undefined) continue
    const entryIndex = state.logs.indexOf(filteredEntry)
    if (entryIndex >= 0) {
      entryEl.addEventListener('click', () => {
        renderLogDetail(filteredEntry, entryIndex)
      })
    }
  }

  if (autoScroll) {
    $logEntries.scrollTop = $logEntries.scrollHeight
  }
}

window.dashboard.updateScopeFilter = (scopes): void => {
  const current = logElements.$logScopeFilter.value
  let html = '<option value="">all scopes</option>'
  for (const s of [...scopes].sort()) {
    html += `<option value="${escapeHtml(s)}"${s === current ? ' selected' : ''}>${escapeHtml(s)}</option>`
  }
  logElements.$logScopeFilter.innerHTML = html
}
