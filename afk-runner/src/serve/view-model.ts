// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

import { flattenPosition } from '../drive/loop.js'
import type { SddEvent } from '../events.js'
import { pipelineMachine } from '../graph/pipeline.js'
import { foldEvents } from '../kernel/fold.js'
import type { KernelContext } from '../kernel/machine.js'
import type { PersistedLite } from '../run-lite.js'
import { deltaSpendOf } from './spend.js'

/**
 * The board's pure card projection (web-board D3): the same kernel fold the
 * drive loop and `analyze` use, joined with the run-index memo, rendered as
 * `RunView` (per run) and `PortfolioView` (sorted cards + totals). The server,
 * sweep, and SSE are shells around it; sorting is attention-first:
 * gate-pending → running → recently finished.
 */

export type RunAttention = 'gate-pending' | 'running' | 'finished'

export interface TaskProgress {
  readonly done: number
  readonly total: number
  /** Tasks failed at least once and re-started — the walk's live retries. */
  readonly retrying: readonly string[]
  /** Tasks terminally failed (fix attempts exhausted). */
  readonly failed: readonly string[]
}

/** Tokens-first spend (cross-run accounting doctrine): cost is a lower bound. Delta-based (tool-reports D1). */
export interface SpendView {
  readonly tokens: number | null
  readonly costUsd: number | null
  readonly costKnown: boolean
}

export interface GateCard {
  readonly mode: string
  readonly version: number
  readonly pendingAgeMs: number | null
  readonly gateFile: string
}

export interface RunView {
  readonly runId: string
  readonly changeName: string
  /** The worktree that started the run — the shared-store attribution key (null on legacy memos). */
  readonly repoRoot: string | null
  readonly attention: RunAttention
  readonly status: string
  readonly stage: string | null
  readonly depth: string | null
  readonly round: { readonly current: number; readonly cap: number } | null
  readonly gate: GateCard | null
  readonly taskProgress: TaskProgress | null
  readonly spend: SpendView
  readonly wallMs: number | null
  readonly lastActivity: string
}

export interface PortfolioTotals {
  readonly runs: number
  readonly gatePending: number
  readonly running: number
  readonly finished: number
  readonly tokens: number
  readonly costUsd: number
  readonly unpricedCount: number
}

export interface PortfolioView {
  readonly cards: readonly RunView[]
  readonly totals: PortfolioTotals
}

export interface RunProjectionInput {
  readonly runId: string
  readonly memo: PersistedLite
  /** The torn-tail-tolerant fold input; null when the log is missing or corrupt (degraded). */
  readonly events: readonly SddEvent[] | null
  readonly now: number
}

const EXECUTION_STAGES = new Set(['implement', 'verify', 'release'])
const TERMINAL_STATUSES = new Set(['completed', 'aborted', 'failed', 'stopped'])

interface Folded {
  readonly position: string
  readonly context: KernelContext
}

/** The one fold home for the serve module: events → flattened position + kernel context (null degraded). */
export function foldRunEvents(events: readonly SddEvent[] | null): Folded | null {
  if (events === null) return null
  const { snapshot } = foldEvents(pipelineMachine, events)
  return { position: flattenPosition(snapshot.value), context: snapshot.context }
}

/**
 * The pending gate, fold-first (fresher than a memo written at an earlier
 * park): an unanswered fold gate wins; a degraded row falls back to the memo.
 */
function gatePendingOf(
  folded: Folded | null,
  memo: PersistedLite,
): { readonly mode: string; readonly version: number } | null {
  if (folded !== null) {
    const gate = folded.context.gate
    return gate !== null && !gate.answered ? { mode: gate.mode, version: gate.version } : null
  }
  return memo.gate
}

function pendingAgeOf(events: readonly SddEvent[] | null, version: number, now: number): number | null {
  if (events === null) return null
  for (let index = events.length - 1; index >= 0; index -= 1) {
    const event = events[index]
    if (event !== undefined && event.type === 'gate' && event.action === 'presented' && event.version === version) {
      return Math.max(0, now - Date.parse(event.ts))
    }
  }
  return null
}

function attentionOf(
  gate: { readonly mode: string; readonly version: number } | null,
  folded: Folded | null,
  memo: PersistedLite,
): RunAttention {
  if (gate !== null) return 'gate-pending'
  if (folded !== null && (folded.position === 'completed' || folded.position === 'aborted')) return 'finished'
  if (TERMINAL_STATUSES.has(memo.status)) return 'finished'
  return 'running'
}

/** The fold-derived status, mirroring accounting's `runs` rendering. */
function statusOf(
  gate: { readonly mode: string; readonly version: number } | null,
  folded: Folded | null,
  memo: PersistedLite,
): string {
  if (gate !== null) return `gate:${gate.mode} v${gate.version}`
  if (folded !== null) {
    if (folded.position === 'completed') return 'completed'
    if (folded.position === 'aborted') return 'aborted'
    if (EXECUTION_STAGES.has(folded.position)) return `exec:${folded.position}`
  }
  return TERMINAL_STATUSES.has(memo.status) ? memo.status : 'running'
}

/** The armed walk's progress line inputs (web-board spec: done/total with failed retries named). */
function taskProgressOf(context: KernelContext): TaskProgress | null {
  if (!context.executionArmed) return null
  const ids = Object.keys(context.tasks)
  if (ids.length === 0) return null
  let done = 0
  const retrying: string[] = []
  const failed: string[] = []
  for (const id of ids) {
    const record = context.tasks[id]
    if (record === undefined) continue
    if (record.status === 'done') done += 1
    else if (record.status === 'failed') failed.push(id)
    else if (record.attempts > 1) retrying.push(id)
  }
  return { done, total: ids.length, retrying, failed }
}

function spendOf(events: readonly SddEvent[] | null): SpendView {
  if (events === null) return { tokens: null, costUsd: null, costKnown: false }
  return deltaSpendOf(events)
}

/** Wall from log timestamps — fresh for live runs; null for a degraded or eventless row. */
function wallMsOf(events: readonly SddEvent[] | null): number | null {
  const first = events?.[0]
  const last = events?.[events.length - 1]
  if (first === undefined || last === undefined) return null
  return Math.max(0, Date.parse(last.ts) - Date.parse(first.ts))
}

function lastActivityOf(events: readonly SddEvent[] | null, memo: PersistedLite): string {
  const last = events?.[events.length - 1]
  return last?.ts ?? memo.updatedAt
}

export function buildRunView(input: RunProjectionInput): RunView {
  const { runId, memo, events, now } = input
  const folded = foldRunEvents(events)
  const gate = gatePendingOf(folded, memo)
  return {
    runId,
    changeName: memo.changeName,
    repoRoot: memo.repoRoot,
    attention: attentionOf(gate, folded, memo),
    status: statusOf(gate, folded, memo),
    stage: folded?.position ?? null,
    depth: folded?.context.depth ?? null,
    round: folded?.context.round ?? null,
    gate:
      gate === null
        ? null
        : {
            mode: gate.mode,
            version: gate.version,
            pendingAgeMs: pendingAgeOf(events, gate.version, now),
            gateFile: `gate-${gate.version}.md`,
          },
    taskProgress: folded === null ? null : taskProgressOf(folded.context),
    spend: spendOf(events),
    wallMs: wallMsOf(events),
    lastActivity: lastActivityOf(events, memo),
  }
}

const ATTENTION_RANK: Readonly<Record<RunAttention, number>> = { 'gate-pending': 0, running: 1, finished: 2 }

export function buildPortfolio(cards: readonly RunView[]): PortfolioView {
  const sorted = [...cards].sort((a, b) => {
    const byRank = ATTENTION_RANK[a.attention] - ATTENTION_RANK[b.attention]
    if (byRank !== 0) return byRank
    if (a.attention === 'gate-pending') {
      const ageA = a.gate?.pendingAgeMs ?? 0
      const ageB = b.gate?.pendingAgeMs ?? 0
      if (ageA !== ageB) return ageB - ageA
    }
    return b.lastActivity.localeCompare(a.lastActivity)
  })
  const count = (attention: RunAttention): number => sorted.filter((card) => card.attention === attention).length
  return {
    cards: sorted,
    totals: {
      runs: sorted.length,
      gatePending: count('gate-pending'),
      running: count('running'),
      finished: count('finished'),
      tokens: sorted.reduce((sum, card) => sum + (card.spend.tokens ?? 0), 0),
      costUsd: sorted.reduce((sum, card) => sum + (card.spend.costUsd ?? 0), 0),
      unpricedCount: sorted.filter((card) => !card.spend.costKnown).length,
    },
  }
}
