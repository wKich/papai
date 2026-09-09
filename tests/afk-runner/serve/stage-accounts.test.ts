// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

import { describe, expect, it } from 'bun:test'
import path from 'node:path'

import type { EventInput, SddEvent, StageId } from '../../../afk-runner/src/events.js'
import { readEvents, stampEvent } from '../../../afk-runner/src/events.js'
import { stageAccountsOf } from '../../../afk-runner/src/serve/stage-accounts.js'

/**
 * The per-stage accounting fold (tool-reports D4): wall from enter/exit
 * ts-windows (re-entries summed; a re-enter while open splits the window, so
 * the in-flight stage's wall runs latest-enter→now), delta spend attributed
 * to the latest-entered window covering its ts — the `roundOfOpens`
 * precedent keyed on stages. Wall is occupancy: gate-park waits count.
 */

const NOW_MS = Date.parse('2026-09-08T07:00:00.000Z')
const T0 = Date.parse('2026-09-08T06:00:00.000Z')

function at(offsetMs: number): string {
  return new Date(T0 + offsetMs).toISOString()
}

function ev(init: EventInput, seq: number, ts: string): SddEvent {
  return stampEvent(init, seq, ts)
}

function enter(stage: StageId, seq: number, ts: string): SddEvent {
  return ev({ altitude: 'L2', type: 'stage_enter', stage }, seq, ts)
}

function exit(stage: StageId, seq: number, ts: string): SddEvent {
  return ev({ altitude: 'L2', type: 'stage_exit', stage }, seq, ts)
}

function stepFinish(agent: string, seq: number, ts: string, tokens: number, costUsd: number): SddEvent {
  return ev(
    {
      altitude: 'L0',
      type: 'step_finish',
      agent,
      tokens: { input: tokens, output: 0, reasoning: 0, cacheRead: 0, cacheWrite: 0 },
      costUsd,
    },
    seq,
    ts,
  )
}

function wallOf(accounts: ReturnType<typeof stageAccountsOf>, stage: string): number {
  return accounts.find((account) => account.stage === stage)?.wallMs ?? 0
}

describe('serve stage-accounts — the ts-window fold', () => {
  it('sums enter/exit windows per stage across re-entries and attributes deltas by ts-window', () => {
    const accounts = stageAccountsOf(
      [
        enter('intake', 1, at(0)),
        exit('intake', 2, at(60_000)),
        enter('draft', 3, at(60_000)),
        stepFinish('drafter', 4, at(120_000), 1_000, 0.4),
        exit('draft', 5, at(180_000)),
        // re-entry: draft opens again; its second window sums with the first
        enter('draft', 6, at(240_000)),
        stepFinish('drafter', 7, at(270_000), 500, 0.2),
        exit('draft', 8, at(300_000)),
      ],
      NOW_MS,
    )
    expect(accounts.map(({ stage, wallMs, tokens, costKnown }) => ({ stage, wallMs, tokens, costKnown }))).toEqual([
      { stage: 'intake', wallMs: 60_000, tokens: 0, costKnown: true },
      { stage: 'draft', wallMs: 180_000, tokens: 1_500, costKnown: true },
    ])
    expect(accounts[1]?.costUsd).toBeCloseTo(0.6, 10)
  })

  it('the in-flight stage runs latest-enter→now: a re-enter while open splits the window', () => {
    const accounts = stageAccountsOf(
      [
        enter('implement', 1, at(0)),
        stepFinish('impl', 2, at(30_000), 700, 0.1),
        // the walk shape: re-enter while still open (previous task → next task)
        enter('implement', 3, at(60_000)),
        stepFinish('impl', 4, at(90_000), 300, 0.1),
      ],
      NOW_MS,
    )
    expect(accounts).toEqual([
      { stage: 'implement', wallMs: NOW_MS - T0, tokens: 1_000, costUsd: 0.2, costKnown: true },
    ])
  })

  it('an unpriced delta marks only its stage unpriced; overlapping windows attribute to the latest-entered stage', () => {
    const accounts = stageAccountsOf(
      [
        enter('decompose', 1, at(0)),
        enter('gate', 2, at(30_000)),
        stepFinish('planner', 3, at(45_000), 900, 0.3),
        stepFinish('waiter', 4, at(60_000), 100, 0),
        exit('decompose', 5, at(90_000)),
        exit('gate', 6, at(120_000)),
      ],
      NOW_MS,
    )
    expect(accounts).toEqual([
      { stage: 'decompose', wallMs: 90_000, tokens: 0, costUsd: 0, costKnown: true },
      { stage: 'gate', wallMs: 90_000, tokens: 1_000, costUsd: 0.3, costKnown: false },
    ])
  })

  it('a delta outside every window attributes nowhere; a spurious exit is ignored', () => {
    const accounts = stageAccountsOf([stepFinish('impl', 1, at(0), 500, 0.1), exit('review', 2, at(10_000))], NOW_MS)
    expect(accounts).toEqual([])
  })
})

describe('serve stage-accounts — the corpus pin', () => {
  const lane = readEvents(
    path.join(import.meta.dir, '..', 'fixtures', 'live', 'walk-item-green-live', 'events.ndjson'),
    () => undefined,
  )

  it("walk-item-green-live accounts every delta: the stages' token sum equals the run's delta total", () => {
    const accounts = stageAccountsOf(lane, NOW_MS)
    expect(accounts.map((account) => account.stage)).toEqual([
      'intake',
      'draft',
      'review',
      'decompose',
      'atomicity',
      'gate',
      'implement',
      'verify',
      'release',
    ])
    expect(accounts.reduce((sum, account) => sum + account.tokens, 0)).toBe(55_074_568)
    const byStage = new Map(accounts.map((account) => [account.stage, account]))
    expect(byStage.get('implement')?.tokens).toBe(38_580_823)
    expect(byStage.get('review')?.wallMs).toBe(2_852_812)
    expect(byStage.get('intake')?.wallMs).toBe(206_668)
    expect(byStage.get('gate')?.tokens).toBe(0)
  })

  it('a mid-walk prefix leaves implement in flight: its wall grows latest-enter→now', () => {
    const prefix = lane.filter((event) => event.seq <= 1_500)
    const at1 = stageAccountsOf(prefix, NOW_MS)
    const at2 = stageAccountsOf(prefix, NOW_MS + 60_000)
    expect(at1.find((account) => account.stage === 'implement')?.tokens).toBeGreaterThan(0)
    // the closed walk windows hold; the in-flight window grows by the clock
    expect(wallOf(at2, 'implement')).toBe(wallOf(at1, 'implement') + 60_000)
  })
})
