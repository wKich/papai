// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

import type { FindingCounts, SddEvent } from '../events.js'
import { openCountsOf } from '../legacy-fold.js'
import type { DigestRecord } from '../legacy-fold.js'
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

export const RECENT_EVENT_LIMIT = 20

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

function summarizeEvent(event: SddEvent): string {
  if (event.type === 'stage_enter' || event.type === 'stage_exit') return `${event.type} ${event.stage}`
  if (event.type === 'stage_failed') return `stage_failed ${event.stage} (${event.kind})`
  if (event.type === 'round_open' || event.type === 'round_close') return `${event.type} ${event.round}/${event.cap}`
  if (event.type === 'gate') {
    return `gate ${event.action} ${event.mode} v${event.version}${event.outcome === undefined ? '' : ` → ${event.outcome}`}`
  }
  if (event.type === 'task') return `task ${event.action} ${event.id}`
  if (event.type === 'convergence') return `convergence r${event.round} ${event.verdict}`
  if (event.type === 'done') return `done ${event.agent}`
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

function recentEventsOf(events: readonly SddEvent[] | null): readonly RecentEvent[] {
  if (events === null) return []
  // The todos panel renders this telemetry (board-todos D2): excluded before
  // the bound is applied, so a todo burst cannot shrink the feed below its size.
  const feed = events.filter((event) => event.type !== 'agent_todos')
  return feed.slice(-RECENT_EVENT_LIMIT).map((event) => ({
    seq: event.seq,
    ts: event.ts,
    summary: summarizeEvent(event),
  }))
}

export function buildRunDetail(input: RunDetailInput): RunDetailView {
  const { runId, memo, events, gateContent } = input
  const card = buildRunView(input)
  const folded = foldRunEvents(events)
  const tasks =
    folded === null
      ? []
      : Object.entries(folded.context.tasks).map(([id, record]) => ({
          id,
          status: record.status,
          attempts: record.attempts,
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
