// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

/**
 * The kernel's declarative context and event vocabulary (extracted from
 * machine.ts at the max-lines seam — types only, no behavior).
 */

import type {
  AutoDecisionKind,
  AutoDecisionRule,
  DepthProfile,
  FailureKind,
  FindingCounts,
  GateOutcome,
} from '../events.js'
import type { AutoDecisionRecord, DigestRecord } from '../legacy-fold.js'

export type StageStatus = 'pending' | 'active' | 'done'

export interface RoundStatus {
  readonly current: number
  readonly cap: number
}

export interface GateRecord {
  readonly mode: 'early' | 'final' | 'plan' | 'escalation' | 'release'
  readonly version: number
  readonly answered: boolean
}

export type ChildStatus = 'pending' | 'running' | 'done' | 'failed'

export interface ChildRecord {
  readonly status: ChildStatus
}

/** Per-task walk status (U3 D4): last task event wins; attempts count started events. */
export type TaskStatus = 'running' | 'done' | 'failed'

export interface TaskRecord {
  readonly status: TaskStatus
  readonly attempts: number
  /**
   * The item's tasks.md text as stamped by its started event's detail
   * (afk-runner-task-todos D2): absent on pre-change logs, preserved through
   * finish rebuilds, re-stamped last-wins by a re-start.
   */
  readonly text?: string
}

/** Scratch tally accumulator: findings counted per round until the round's convergence flushes them. */
export interface TallyCounts {
  readonly resolved: number
  readonly dismissed: number
}

export type RoundTally = Readonly<Record<number, TallyCounts>>

export interface KernelContext {
  readonly stages: Readonly<Record<string, StageStatus>>
  readonly depth: DepthProfile | null
  readonly round: RoundStatus | null
  readonly perRound: readonly DigestRecord[]
  readonly lastVerdict: DigestRecord | null
  readonly gate: GateRecord | null
  readonly autoDecisions: readonly AutoDecisionRecord[]
  readonly children: Readonly<Record<string, ChildRecord>>
  readonly tally: RoundTally
  /**
   * Non-projected gate residue (C4, like the tally — never a parity field):
   * the latest explicit answered outcome and the presented deadline stamp,
   * null on historical logs and re-cleared by every presentation.
   */
  readonly gateOutcome: GateOutcome | null
  readonly gateDeadlineAt: string | null
  /** Whether this gate version's deadline was already re-armed once (D4). */
  readonly gateDeadlineReArmed: boolean
  /**
   * Non-projected failure residue (C6 D2, like the tally): per-stage
   * consecutive declared-failure counts, cleared by that stage's exit and by
   * escalation-extend — never a parity field.
   */
  readonly failures: Readonly<Record<string, number>>
  /** The last declared failure kind per stage (C6 D3) — precondition escalates immediately. */
  readonly failureKinds: Readonly<Record<string, FailureKind>>
  /**
   * Execution arming (U3 D1, non-projected residue): derived from the armed
   * fact event alone — unarmed (and every historical) log folds false.
   */
  readonly executionArmed: boolean
  /** Per-task walk records (U3 D4, non-projected residue like children). */
  readonly tasks: Readonly<Record<string, TaskRecord>>
}

export function initialKernelContext(stages: Readonly<Record<string, StageStatus>>): KernelContext {
  return {
    stages,
    depth: null,
    round: null,
    perRound: [],
    lastVerdict: null,
    gate: null,
    autoDecisions: [],
    children: {},
    tally: {},
    gateOutcome: null,
    gateDeadlineAt: null,
    gateDeadlineReArmed: false,
    failures: {},
    failureKinds: {},
    executionArmed: false,
    tasks: {},
  }
}

export type KernelEvent =
  | { readonly type: 'stage.enter'; readonly stage: string }
  | { readonly type: 'stage.exit'; readonly stage: string }
  | { readonly type: 'stage.failed'; readonly stage: string; readonly kind: FailureKind }
  | { readonly type: 'depth'; readonly profile: DepthProfile }
  | { readonly type: 'round.open'; readonly round: number; readonly cap: number }
  | { readonly type: 'round.close'; readonly round: number; readonly cap: number }
  | {
      readonly type: 'finding'
      readonly action: 'filed' | 'classified' | 'resolved' | 'dismissed'
      readonly round: number
    }
  | {
      readonly type: 'convergence'
      readonly round: number
      readonly verdict: 'converged' | 'needs-review' | 'open'
      readonly counts: FindingCounts
      /** Only what a human must settle; absent on a pre-split line, folding as `counts`. */
      readonly open?: FindingCounts
      /** Thrashing concern cluster ids (loop-memory D5); absent lines fold as `[]`. */
      readonly concerns?: readonly string[]
    }
  | {
      readonly type: 'gate.presented'
      readonly mode: GateRecord['mode']
      readonly version: number
      readonly deadlineAt?: string
    }
  | { readonly type: 'gate.answered'; readonly outcome?: GateOutcome }
  | { readonly type: 'gate.rearmed'; readonly version: number; readonly deadlineAt: string }
  | {
      readonly type: 'auto.decision'
      readonly rule: AutoDecisionRule
      readonly decision: AutoDecisionKind
      readonly evidenceDigest: string
      readonly gateVersion: number
      readonly seq: number
      readonly ts: string
    }
  | { readonly type: 'plan' }
  | { readonly type: 'run.abort' }
  | { readonly type: 'child.spawned'; readonly child: string }
  | { readonly type: 'child.done'; readonly child: string; readonly outcome: 'done' | 'failed' }
  | { readonly type: 'execution.armed' }
  | { readonly type: 'task.started'; readonly id: string; readonly detail?: string }
  | { readonly type: 'task.done'; readonly id: string }
  | { readonly type: 'task.failed'; readonly id: string }
