// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

import type { FindingCounts, SddEvent } from '../events.js'
import { openCountsOf } from '../legacy-fold.js'
import type { DigestRecord } from '../legacy-fold.js'
import { tokensOf } from '../work/gate-signals.js'
import { agentStripsOf } from './agent-strips.js'
import type { AgentStrip } from './agent-strips.js'
import { stageAccountsOf } from './stage-accounts.js'
import type { StageAccount } from './stage-accounts.js'
import type { RunProjectionInput, RunView } from './view-model.js'
import { buildRunView, foldRunEvents } from './view-model.js'

/**
 * The run-detail projection (web-board spec): the pipeline position, the
 * per-round history with raised and open counts, the per-task walk with
 * attempt counts for armed runs, a bounded recent-events feed, the agent
 * todos panel's last-snapshot-per-agent input, and — for a pending gate —
 * the gate file rendered read-only. It offers no action that settles,
 * steers, or mutates the run.
 */

/**
 * The live window's bound applies to rendered feed content (tool-reports
 * D3): signal lines after the tier exclusions. Sized so typical runs fit
 * whole — the corpus measures 60–430 signal events per lane and 250 covers
 * 10/16 lanes entirely; earlier events page through `/api/runs/:id/events`.
 */
export const SIGNAL_EVENT_LIMIT = 250

export interface RoundHistory {
  readonly round: number
  readonly verdict: string
  /** Every finding the round recorded — the trajectory's number. */
  readonly raised: FindingCounts
  /** Only what a human must settle — the gate's number. */
  readonly open: FindingCounts
}

export interface TaskWalkEntry {
  readonly id: string
  readonly status: string
  readonly attempts: number
  /** The item's text from the folded record (afk-runner-task-todos D6) — null when the log carries none. */
  readonly text: string | null
}

export interface RecentEvent {
  readonly seq: number
  readonly ts: string
  readonly summary: string
}

export interface DetailGate {
  readonly mode: string
  readonly version: number
  readonly file: string
  readonly content: string | null
}

export interface TodoItem {
  readonly content: string
  readonly status: string
}

export interface AgentTodosEntry {
  readonly agent: string
  readonly updatedAt: string
  readonly items: readonly TodoItem[]
}

export interface RunDetailView {
  readonly runId: string
  readonly changeName: string
  readonly attention: RunView['attention']
  readonly status: string
  readonly position: string | null
  readonly stages: Readonly<Record<string, string>>
  readonly depth: string | null
  readonly round: { readonly current: number; readonly cap: number } | null
  readonly rounds: readonly RoundHistory[]
  readonly tasks: readonly TaskWalkEntry[]
  readonly todos: readonly AgentTodosEntry[]
  /** Implementers whose spawn completed without emitting todos (afk-runner-task-todos D6) — labels, no synthesized items. */
  readonly missingTodos: readonly string[]
  readonly strips: readonly AgentStrip[]
  readonly stageAccounts: readonly StageAccount[]
  readonly recentEvents: readonly RecentEvent[]
  readonly gate: DetailGate | null
  readonly taskProgress: RunView['taskProgress']
  readonly spend: RunView['spend']
  readonly wallMs: number | null
  readonly lastActivity: string
}

export interface RunDetailInput extends RunProjectionInput {
  readonly gateContent: string | null
}

function roundHistoryOf(record: DigestRecord): RoundHistory {
  return { round: record.round, verdict: record.verdict, raised: record.counts, open: openCountsOf(record) }
}

/** A feed line's detail clause stays a line: line breaks collapse, bounded like a gate row gap. */
const MAX_DETAIL_LEN = 160

function boundedDetail(detail: string): string {
  const oneLine = detail.replace(/[\r\n]+/gu, ' ')
  return oneLine.length > MAX_DETAIL_LEN ? `${oneLine.slice(0, MAX_DETAIL_LEN - 1)}…` : oneLine
}

/** Compact tokens for one feed line, mirroring the client's ticker format. */
function fmtTokens(tokens: number): string {
  if (tokens < 1000) return String(tokens)
  if (tokens < 1_000_000) return `${Math.round(tokens / 100) / 10}K`
  if (tokens < 1_000_000_000) return `${Math.round(tokens / 10_000) / 100}M`
  return `${Math.round(tokens / 10_000_000) / 100}B`
}

function summarizeEvent(event: SddEvent): string {
  if (event.type === 'stage_enter' || event.type === 'stage_exit') return `${event.type} ${event.stage}`
  if (event.type === 'stage_failed') return `stage_failed ${event.stage} (${event.kind})`
  if (event.type === 'round_open' || event.type === 'round_close') return `${event.type} ${event.round}/${event.cap}`
  if (event.type === 'gate') {
    return `gate ${event.action} ${event.mode} v${event.version}${event.outcome === undefined ? '' : ` → ${event.outcome}`}`
  }
  if (event.type === 'task') {
    const detail = event.detail === undefined ? '' : ` — ${boundedDetail(event.detail)}`
    return `task ${event.action} ${event.id}${detail}`
  }
  if (event.type === 'convergence') return `convergence r${event.round} ${event.verdict}`
  if (event.type === 'spawned') return `spawned ${event.agent} · ${event.role} · ${event.model}`
  if (event.type === 'finding') {
    const cls = event.class === undefined ? '' : ` ${event.class}`
    const detail = event.detail === undefined ? '' : ` — ${boundedDetail(event.detail)}`
    return `finding ${event.action} ${event.id}${cls}${detail}`
  }
  if (event.type === 'done') {
    const model = event.model === undefined ? '' : ` · ${event.model}`
    const tokens = tokensOf(event.usage)
    const cost = event.usage.costUsd > 0 ? `$${event.usage.costUsd.toFixed(2)}` : tokens > 0 ? 'cost unknown' : '$0.00'
    return `done ${event.agent}${model} · ${fmtTokens(tokens)} tok · ${cost}`
  }
  if (event.type === 'retrying') return `retrying ${event.agent} · ${event.reason} · attempt ${event.attempt}`
  if (event.type === 'killed') return `killed ${event.agent} · ${event.cause}`
  return event.type
}

/**
 * The last `agent_todos` snapshot per agent (board-todos D1): one backwards
 * pass, first sighting per label in reverse is that agent's latest snapshot;
 * collection order is therefore most-recent-snapshot first. The scan skips
 * already-seen labels and rides the array the detail projection already
 * holds — no fold change, no new read.
 */
function todosOf(events: readonly SddEvent[] | null): readonly AgentTodosEntry[] {
  if (events === null) return []
  const latest = new Map<string, AgentTodosEntry>()
  for (let index = events.length - 1; index >= 0; index -= 1) {
    const event = events[index]
    if (event === undefined || event.type !== 'agent_todos' || latest.has(event.agent)) continue
    latest.set(event.agent, { agent: event.agent, updatedAt: event.ts, items: event.todos })
  }
  return [...latest.values()]
}

/**
 * Labels carrying a `todos_missing` mark (afk-runner-task-todos D6), deduped
 * in first-appearance order — the todos panel's no-todos-emitted note input.
 * Names only: the panel never presents runner-synthesized todo content.
 */
function missingTodosOf(events: readonly SddEvent[] | null): readonly string[] {
  if (events === null) return []
  const labels = new Set<string>()
  for (const event of events) {
    if (event.type === 'todos_missing') labels.add(event.agent)
  }
  return [...labels]
}

/**
 * Feed eligibility (tool-reports D2): todo telemetry renders in the todos
 * panel, `step_finish` in the spend ticker, and `tool_use` in the per-agent
 * strips — none of them feed; a still-pending `auto_decision` is waiter
 * heartbeat — excluded **before** the bound so a heartbeat flood cannot
 * shrink the feed (the 6,333-pending lane is the pin). Non-pending
 * auto-decisions are gate signal and stay.
 */
function isFeedEvent(event: SddEvent): boolean {
  if (event.type === 'agent_todos' || event.type === 'step_finish' || event.type === 'tool_use') return false
  if (event.type === 'auto_decision' && event.decision === 'pending') return false
  return true
}

function recentEventOf(event: SddEvent): RecentEvent {
  return { seq: event.seq, ts: event.ts, summary: summarizeEvent(event) }
}

function recentEventsOf(events: readonly SddEvent[] | null): readonly RecentEvent[] {
  if (events === null) return []
  const feed = events.filter(isFeedEvent)
  return feed.slice(-SIGNAL_EVENT_LIMIT).map(recentEventOf)
}

/**
 * One history page below the live window (tool-reports D3): the last `limit`
 * feed events with `seq < before`, ascending — the same exclusions as the
 * feed, so pages never carry heartbeat or telemetry lines. Below-tail pages
 * are immutable by construction (append-only log).
 */
export function eventsPageOf(events: readonly SddEvent[], before: number, limit: number): readonly RecentEvent[] {
  const feed = events.filter((event) => event.seq < before && isFeedEvent(event))
  return feed.slice(-limit).map(recentEventOf)
}

export function buildRunDetail(input: RunDetailInput): RunDetailView {
  const { runId, memo, events, now, gateContent } = input
  const card = buildRunView(input)
  const folded = foldRunEvents(events)
  const tasks =
    folded === null
      ? []
      : Object.entries(folded.context.tasks).map(([id, record]) => ({
          id,
          status: record.status,
          attempts: record.attempts,
          text: record.text ?? null,
        }))
  return {
    runId,
    changeName: memo.changeName,
    attention: card.attention,
    status: card.status,
    position: folded?.position ?? null,
    stages: folded === null ? {} : { ...folded.context.stages },
    depth: card.depth,
    round: card.round,
    rounds: folded === null ? [] : folded.context.perRound.map(roundHistoryOf),
    tasks,
    todos: todosOf(events),
    missingTodos: missingTodosOf(events),
    strips: events === null ? [] : agentStripsOf(events),
    stageAccounts: events === null ? [] : stageAccountsOf(events, now),
    recentEvents: recentEventsOf(events),
    gate:
      card.gate === null
        ? null
        : { mode: card.gate.mode, version: card.gate.version, file: card.gate.gateFile, content: gateContent },
    taskProgress: card.taskProgress,
    spend: card.spend,
    wallMs: card.wallMs,
    lastActivity: card.lastActivity,
  }
}
