// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

import { describe, expect, it } from 'bun:test'
import path from 'node:path'

import type { EventInput, SddEvent } from '../../../afk-runner/src/events.js'
import { readEvents, stampEvent } from '../../../afk-runner/src/events.js'
import { deltaSpendOf } from '../../../afk-runner/src/serve/spend.js'
import { usageTotalsOf } from '../../../afk-runner/src/work/gate-signals.js'

/**
 * The board-local delta spend fold (tool-reports D1): spend = Σ `step_finish`
 * deltas + per-completion clamped residuals, `costKnown` fail-closed per
 * contributing delta. Unit fixtures prove the union rule's three cases
 * (clean, killed-turn, done-without-deltas); the corpus lanes pin the live
 * numbers the change was measured against.
 */

const LIVE_ROOT = path.join(import.meta.dir, '..', 'fixtures', 'live')

function at(offsetMs: number): string {
  return new Date(Date.parse('2026-09-01T00:00:00.000Z') + offsetMs).toISOString()
}

function ev(init: EventInput, seq: number, ts: string): SddEvent {
  return stampEvent(init, seq, ts)
}

function stepFinish(agent: string, seq: number, tokens: number, costUsd: number): SddEvent {
  return ev(
    {
      altitude: 'L0',
      type: 'step_finish',
      agent,
      tokens: { input: tokens, output: 0, reasoning: 0, cacheRead: 0, cacheWrite: 0 },
      costUsd,
    },
    seq,
    at(seq * 60_000),
  )
}

function doneOf(agent: string, seq: number, tokens: number, costUsd: number): SddEvent {
  return ev(
    {
      altitude: 'L1',
      type: 'done',
      agent,
      usage: {
        inputTokens: tokens,
        outputTokens: 0,
        reasoningTokens: 0,
        cachedReadTokens: 0,
        cachedWriteTokens: 0,
        costUsd,
        wallMs: 0,
      },
    },
    seq,
    at(seq * 60_000),
  )
}

describe('serve spend — the union rule over unit fixtures', () => {
  it('a clean agent renders Σdeltas, equal to the done-based total', () => {
    const events = [stepFinish('impl', 1, 900, 0.25), stepFinish('impl', 2, 300, 0.1), doneOf('impl', 3, 1_200, 0.35)]
    expect(deltaSpendOf(events)).toEqual({ tokens: 1_200, costUsd: 0.35, costKnown: true })
    expect(deltaSpendOf(events).tokens).toBe(usageTotalsOf(events).tokens)
  })

  it("a killed turn's deltas stay counted when the continuation's done reports only post-continuation usage", () => {
    const events = [
      stepFinish('impl', 1, 500, 0.1),
      ev({ altitude: 'L1', type: 'killed', agent: 'impl', cause: 'timeout' }, 2, at(2 * 60_000)),
      stepFinish('impl', 3, 200, 0.05),
      doneOf('impl', 4, 200, 0.05),
    ]
    const spend = deltaSpendOf(events)
    expect(spend.tokens).toBe(700)
    expect(spend.costUsd).toBeCloseTo(0.15, 10)
    expect(spend.costKnown).toBe(true)
    expect(usageTotalsOf(events).tokens).toBe(200)
  })

  it('a completion aggregate without per-step deltas is counted exactly once through the clamped residual', () => {
    const events = [doneOf('impl', 1, 400, 0.1)]
    expect(deltaSpendOf(events)).toEqual({ tokens: 400, costUsd: 0.1, costKnown: true })
  })

  it('agents accumulate independently: one agent completion never resets another agent deltas', () => {
    const events = [
      stepFinish('a', 1, 100, 0.01),
      stepFinish('b', 2, 50, 0.02),
      doneOf('a', 3, 100, 0.01),
      stepFinish('b', 4, 70, 0.03),
      doneOf('b', 5, 120, 0.05),
    ]
    expect(deltaSpendOf(events)).toEqual({ tokens: 220, costUsd: 0.06, costKnown: true })
  })

  it('a delta carrying tokens with zero cost makes the cost unknown', () => {
    const spend = deltaSpendOf([stepFinish('impl', 1, 4_200, 0)])
    expect(spend).toEqual({ tokens: 4_200, costUsd: 0, costKnown: false })
  })

  it('an unpriced residual (tokens with zero cost, no deltas) makes the cost unknown', () => {
    const spend = deltaSpendOf([doneOf('impl', 1, 4_200, 0)])
    expect(spend).toEqual({ tokens: 4_200, costUsd: 0, costKnown: false })
  })

  it('a log with no usage events renders zero spend, priced', () => {
    expect(deltaSpendOf([ev({ altitude: 'L2', type: 'stage_enter', stage: 'intake' }, 1, at(0))])).toEqual({
      tokens: 0,
      costUsd: 0,
      costKnown: true,
    })
  })
})

describe('serve spend — corpus lane pins', () => {
  it('walk-item-green-live renders the delta truth: 55.07M tok · $20.00, not the kill-lossy done-based 46.46M', () => {
    const events = readLane('walk-item-green-live')
    const spend = deltaSpendOf(events)
    expect(spend.tokens).toBe(55_074_568)
    expect(spend.costUsd).toBeCloseTo(19.999, 3)
    expect(spend.costKnown).toBe(true)
    expect(spend.tokens).toBeGreaterThan(usageTotalsOf(events).tokens)
  })

  it('killed-turn-usage-undercount-live keeps its unpriced costKnown: false and the clean-lane total equality', () => {
    const events = readLane('killed-turn-usage-undercount-live')
    const spend = deltaSpendOf(events)
    expect(spend.tokens).toBe(9_128_885)
    expect(spend.costUsd).toBe(0)
    expect(spend.costKnown).toBe(false)
    expect(spend.tokens).toBe(usageTotalsOf(events).tokens)
  })
})

function readLane(lane: string): readonly SddEvent[] {
  return readEvents(path.join(LIVE_ROOT, lane, 'events.ndjson'), () => undefined)
}
