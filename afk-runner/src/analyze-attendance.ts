// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

import type { RunBundle } from './analyze-io.js'
import { knownMetric, unknownMetric } from './analyze.js'
import type { Metric } from './analyze.js'
import type { GateMode, SddEvent } from './event-schemas.js'

/**
 * Gate attendance forensics (afk-runner-service Phase 0, design D2):
 * settle-origin attribution — the same emission-order join the extend-origin
 * rule applies in `analyze-gates.ts`, kept local per the analyze-* family
 * pattern — joined with presented→answered wait latency. The corpus
 * aggregate (human-settle rate, human-wait summary, pending and unknown
 * listed beside the rate) prices how much supervision the corpus's gates
 * actually demanded. Zero spawns: every fact is already in the log.
 */

export type AttendanceOrigin = 'human' | 'policy' | 'waiter'

export interface AttendanceAnsweredRow {
  readonly version: number
  readonly mode: GateMode
  readonly origin: AttendanceOrigin
  readonly waitMs: number
}

export interface AttendancePendingRow {
  readonly version: number
  readonly mode: GateMode
  readonly ageMs: number
}

export interface AttendanceUnknownRow {
  readonly version: number
  readonly reason: string
}

export interface GateAttendance {
  readonly answered: readonly AttendanceAnsweredRow[]
  readonly pending: readonly AttendancePendingRow[]
  readonly unknown: readonly AttendanceUnknownRow[]
}

interface AttendanceMaps {
  readonly presentedAt: ReadonlyMap<number, string>
  readonly answeredAt: ReadonlyMap<number, string>
  readonly answeredSeq: ReadonlyMap<number, number>
  readonly modeOf: ReadonlyMap<number, GateMode>
  readonly approveSeqBy: ReadonlyMap<number, number>
  readonly extendSeqBy: ReadonlyMap<number, number>
}

/** First-wins presentation/answer stamps per gate version plus the first settle-kind record seqs. */
function attendanceMapsOf(events: readonly SddEvent[]): AttendanceMaps {
  const presentedAt = new Map<number, string>()
  const answeredAt = new Map<number, string>()
  const answeredSeq = new Map<number, number>()
  const modeOf = new Map<number, GateMode>()
  const approveSeqBy = new Map<number, number>()
  const extendSeqBy = new Map<number, number>()
  for (const event of events) {
    if (event.type === 'gate') {
      if (!modeOf.has(event.version)) modeOf.set(event.version, event.mode)
      if (event.action === 'presented' && !presentedAt.has(event.version)) presentedAt.set(event.version, event.ts)
      if (event.action === 'answered' && !answeredAt.has(event.version)) {
        answeredAt.set(event.version, event.ts)
        answeredSeq.set(event.version, event.seq)
      }
    } else if (event.type === 'auto_decision') {
      if (event.decision === 'approve' && !approveSeqBy.has(event.gateVersion)) {
        approveSeqBy.set(event.gateVersion, event.seq)
      }
      if (event.decision === 'extend' && !extendSeqBy.has(event.gateVersion)) {
        extendSeqBy.set(event.gateVersion, event.seq)
      }
    }
  }
  return { presentedAt, answeredAt, answeredSeq, modeOf, approveSeqBy, extendSeqBy }
}

/** Emission-order join: a settle-kind record below the answered seq names policy, above it the waiter, absence names the human. */
function originOf(maps: AttendanceMaps, version: number): AttendanceOrigin {
  const answeredSeq = maps.answeredSeq.get(version)
  const recordSeq = maps.approveSeqBy.get(version) ?? maps.extendSeqBy.get(version)
  if (answeredSeq === undefined || recordSeq === undefined) return 'human'
  return recordSeq < answeredSeq ? 'policy' : 'waiter'
}

export function gateAttendance(bundle: RunBundle, now: Date): Metric<GateAttendance> {
  const maps = attendanceMapsOf(bundle.events)
  if (maps.presentedAt.size === 0 && maps.answeredAt.size === 0) return unknownMetric('no gate events')
  const answered: AttendanceAnsweredRow[] = []
  const unknown: AttendanceUnknownRow[] = []
  for (const [version, answeredTs] of [...maps.answeredAt.entries()].sort((a, b) => a[0] - b[0])) {
    const presentedTs = maps.presentedAt.get(version)
    if (presentedTs === undefined) {
      unknown.push({ version, reason: 'no presentation record' })
      continue
    }
    const presentedMs = new Date(presentedTs).getTime()
    const answeredMs = new Date(answeredTs).getTime()
    if (Number.isNaN(presentedMs)) {
      unknown.push({ version, reason: 'unparsable presentation timestamp' })
      continue
    }
    if (Number.isNaN(answeredMs)) {
      unknown.push({ version, reason: 'unparsable answer timestamp' })
      continue
    }
    answered.push({
      version,
      mode: maps.modeOf.get(version) ?? 'final',
      origin: originOf(maps, version),
      waitMs: Math.max(0, answeredMs - presentedMs),
    })
  }
  const pending: AttendancePendingRow[] = [...maps.presentedAt.entries()]
    .filter(([version]) => !maps.answeredAt.has(version))
    .sort((a, b) => a[0] - b[0])
    .map(([version, ts]) => ({
      version,
      mode: maps.modeOf.get(version) ?? 'final',
      ageMs: Math.max(0, now.getTime() - new Date(ts).getTime()),
    }))
  return knownMetric({ answered, pending, unknown })
}

export interface AttendanceAggregate {
  readonly answered: number
  readonly human: number
  readonly policy: number
  readonly waiter: number
  readonly humanSettleRate: number
  readonly humanWaitMedianMs: number | null
  readonly humanWaitUpperBoundMs: number | null
  readonly pendingGates: number
  readonly unknownGates: number
}

/** Median of an even-length set averages the middle pair; an empty set reports null. */
function medianOf(values: readonly number[]): number | null {
  if (values.length === 0) return null
  const sorted = [...values].sort((a, b) => a - b)
  const mid = Math.floor(sorted.length / 2)
  const high = sorted[mid]
  if (high === undefined) return null
  if (sorted.length % 2 === 1) return high
  const low = sorted[mid - 1]
  return low === undefined ? high : (low + high) / 2
}

/**
 * The corpus reduce over per-run attendance: the rate is human over every
 * answered gate — unknown rows stay in the denominator so reduced coverage
 * dilutes visibly instead of hiding — and the wait summary covers
 * human-attributed gates only. Null when no run contributed attendance.
 */
export function attendanceAggregateOf(parts: readonly GateAttendance[]): AttendanceAggregate | null {
  if (parts.length === 0) return null
  let answered = 0
  let human = 0
  let policy = 0
  let waiter = 0
  let pendingGates = 0
  let unknownGates = 0
  const humanWaits: number[] = []
  for (const part of parts) {
    for (const row of part.answered) {
      answered += 1
      if (row.origin === 'human') {
        human += 1
        humanWaits.push(row.waitMs)
      } else if (row.origin === 'policy') policy += 1
      else waiter += 1
    }
    // unjoinable gates were answered too — they ride the denominator so
    // reduced coverage dilutes the rate visibly instead of hiding
    answered += part.unknown.length
    pendingGates += part.pending.length
    unknownGates += part.unknown.length
  }
  return {
    answered,
    human,
    policy,
    waiter,
    humanSettleRate: answered === 0 ? 0 : human / answered,
    humanWaitMedianMs: medianOf(humanWaits),
    humanWaitUpperBoundMs: humanWaits.length === 0 ? null : Math.max(...humanWaits),
    pendingGates,
    unknownGates,
  }
}
