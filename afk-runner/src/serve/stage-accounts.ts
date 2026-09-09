// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

import type { SddEvent } from '../events.js'

/**
 * The per-stage accounting fold (tool-reports D4): stage wall from
 * enter/exit ts-windows — a re-enter while open splits the window (the walk's
 * task-to-task shape), so completed walls sum re-entries and the in-flight
 * stage's wall runs latest-enter→render time. Wall is occupancy time: a
 * gate-parked stage's wait counts toward its stage. Delta spend attributes to
 * the latest-entered window covering its ts (overlapping stages — decompose
 * parking under gate — resolve to the innermost), the analyzer's `roundOfOpens`
 * precedent keyed on stages.
 */

export interface StageAccount {
  readonly stage: string
  readonly wallMs: number
  readonly tokens: number
  readonly costUsd: number
  readonly costKnown: boolean
}

interface StageWindow {
  readonly stage: string
  readonly start: number
  readonly end: number
}

interface Acc {
  wallMs: number
  tokens: number
  costUsd: number
  costKnown: boolean
}

function stepTokensOf(tokens: {
  input: number
  output: number
  reasoning: number
  cacheRead: number
  cacheWrite: number
}): number {
  return tokens.input + tokens.output + tokens.reasoning + tokens.cacheRead + tokens.cacheWrite
}

/** The latest-entered window containing `ts`, or null outside every window. */
function coveringWindow(windows: readonly StageWindow[], ts: number): StageWindow | null {
  let best: StageWindow | null = null
  for (const window of windows) {
    if (window.start <= ts && ts <= window.end && (best === null || window.start > best.start)) best = window
  }
  return best
}

interface Delta {
  readonly ts: number
  readonly tokens: number
  readonly costUsd: number
}

/** Attribute every buffered delta to the latest-entered window covering its ts. */
function attributeDeltas(deltas: readonly Delta[], windows: readonly StageWindow[], accs: Map<string, Acc>): void {
  for (const delta of deltas) {
    const window = coveringWindow(windows, delta.ts)
    const acc = window === null ? undefined : accs.get(window.stage)
    if (acc === undefined) continue
    acc.tokens += delta.tokens
    acc.costUsd += delta.costUsd
    if (delta.tokens > 0 && delta.costUsd === 0) acc.costKnown = false
  }
}

export function stageAccountsOf(events: readonly SddEvent[], now: number): readonly StageAccount[] {
  const order: string[] = []
  const accs = new Map<string, Acc>()
  const openSince = new Map<string, number>()
  const windows: StageWindow[] = []
  const deltas: Delta[] = []
  const open = (stage: string, start: number): void => {
    if (!accs.has(stage)) {
      order.push(stage)
      accs.set(stage, { wallMs: 0, tokens: 0, costUsd: 0, costKnown: true })
    }
    openSince.set(stage, start)
  }
  const close = (stage: string, end: number): void => {
    const start = openSince.get(stage)
    if (start === undefined) return
    windows.push({ stage, start, end })
    const acc = accs.get(stage)
    if (acc !== undefined) acc.wallMs += end - start
    openSince.delete(stage)
  }

  for (const event of events) {
    if (event.type === 'stage_enter') {
      const ts = Date.parse(event.ts)
      // a re-enter while open splits the window: the completed part closes at
      // the re-entry, keeping the in-flight anchor at the latest entry
      if (openSince.has(event.stage)) close(event.stage, ts)
      open(event.stage, ts)
    } else if (event.type === 'stage_exit') {
      close(event.stage, Date.parse(event.ts))
    } else if (event.type === 'step_finish') {
      // buffered: a delta's window may still be open when it arrives —
      // attribution resolves once every window is known
      deltas.push({ ts: Date.parse(event.ts), tokens: stepTokensOf(event.tokens), costUsd: event.costUsd })
    }
  }
  for (const [stage, start] of openSince) {
    const acc = accs.get(stage)
    if (acc !== undefined) acc.wallMs += Math.max(0, now - start)
    windows.push({ stage, start, end: now })
  }
  attributeDeltas(deltas, windows, accs)
  return order.map((stage) => {
    const acc = accs.get(stage)
    return acc === undefined ? { stage, wallMs: 0, tokens: 0, costUsd: 0, costKnown: true } : { stage, ...acc }
  })
}
