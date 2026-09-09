// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

import { afterEach, describe, expect, it } from 'bun:test'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'

import type { AgentUsage, EventInput, SddEvent, StageId } from '../../../afk-runner/src/events.js'
import { stampEvent } from '../../../afk-runner/src/events.js'
import type { PersistedLite } from '../../../afk-runner/src/run-lite.js'
import { nodeServeFs } from '../../../afk-runner/src/serve/fs-seam.js'
import { loadPortfolio, loadRunDetail } from '../../../afk-runner/src/serve/load.js'
import { RECENT_EVENT_LIMIT, buildRunDetail } from '../../../afk-runner/src/serve/run-detail.js'
import { buildPortfolio, buildRunView } from '../../../afk-runner/src/serve/view-model.js'

/**
 * The pure fold→view projection (web-board D3): card fields, portfolio sort,
 * and the run-detail walk — unit-tested without I/O; the fs shells ride real
 * temp work dirs. Events boot from the machine's `start` position through
 * intake, exactly as live logs do.
 */

const NOW_MS = Date.parse('2026-09-01T12:00:00.000Z')
const NOW = new Date(NOW_MS)

function at(offsetMs: number): string {
  return new Date(Date.parse('2026-09-01T00:00:00.000Z') + offsetMs).toISOString()
}

function ev(init: EventInput, seq: number, ts: string): SddEvent {
  return stampEvent(init, seq, ts)
}

function liteMemo(runId: string, overrides: Partial<PersistedLite> = {}): PersistedLite {
  return {
    runId,
    status: 'running',
    gate: null,
    changeName: runId,
    updatedAt: at(60_000),
    repoRoot: null,
    ...overrides,
  }
}

interface RunFixture {
  readonly runId: string
  readonly memo: PersistedLite
  readonly events: SddEvent[]
}

/** Enter/exit pairs through the given stages, then a bare enter of the last one when `leaveLast` is false. */
function walkThrough(stages: readonly StageId[], startSeq: number, ts: string, leaveLast = false): SddEvent[] {
  const events: SddEvent[] = []
  let seq = startSeq
  for (const stage of stages) {
    events.push(ev({ altitude: 'L2', type: 'stage_enter', stage }, seq++, ts))
    events.push(ev({ altitude: 'L2', type: 'stage_exit', stage }, seq++, ts))
  }
  if (!leaveLast && events.length >= 2) events.pop()
  return events
}

const GATE_PRESENTED_TS = at(10 * 60_000)

/** A run parked at an escalation gate mid-review: position gate.awaiting, review active. */
function gatePendingRun(): RunFixture {
  return {
    runId: 'gate-run',
    memo: liteMemo('gate-run', { gate: { mode: 'escalation', version: 2 }, updatedAt: GATE_PRESENTED_TS }),
    events: [
      ...walkThrough(['intake', 'draft'], 1, at(1 * 60_000)),
      ev({ altitude: 'L2', type: 'stage_enter', stage: 'review' }, 5, at(5 * 60_000)),
      ev({ altitude: 'L2', type: 'gate', action: 'presented', mode: 'escalation', version: 2 }, 6, GATE_PRESENTED_TS),
    ],
  }
}

/** The think-half prefix through the final gate, parked for the armed approve. */
function armedPrefix(startSeq: number, ts: string): SddEvent[] {
  let seq = startSeq
  return [
    ev({ altitude: 'L2', type: 'execution', action: 'armed' }, seq++, ts),
    ...walkThrough(['intake', 'draft'], seq, ts),
    ev({ altitude: 'L2', type: 'stage_enter', stage: 'review' }, seq + 4, ts),
    ev({ altitude: 'L2', type: 'round_open', round: 1, cap: 3 }, seq + 5, ts),
    ev(
      {
        altitude: 'L2',
        type: 'convergence',
        round: 1,
        verdict: 'converged',
        counts: { blocker: 0, material: 0, nitpick: 0 },
      },
      seq + 6,
      ts,
    ),
    ev({ altitude: 'L2', type: 'stage_exit', stage: 'review' }, seq + 7, ts),
    ev({ altitude: 'L2', type: 'stage_enter', stage: 'decompose' }, seq + 8, ts),
    ev({ altitude: 'L2', type: 'stage_enter', stage: 'gate' }, seq + 9, ts),
    ev({ altitude: 'L2', type: 'gate', action: 'presented', mode: 'final', version: 1 }, seq + 10, ts),
    ev({ altitude: 'L2', type: 'stage_exit', stage: 'decompose' }, seq + 11, ts),
    ev({ altitude: 'L2', type: 'stage_exit', stage: 'gate' }, seq + 12, ts),
    ev({ altitude: 'L2', type: 'stage_enter', stage: 'implement' }, seq + 13, ts),
    ev(
      { altitude: 'L2', type: 'gate', action: 'answered', mode: 'final', version: 1, outcome: 'approve' },
      seq + 14,
      ts,
    ),
  ]
}

/** Seven tasks done of nine started; t8 failed once and re-started (retrying); t9 failed terminally. */
function armedRun(): RunFixture {
  const events = [...armedPrefix(1, at(20 * 60_000))]
  let seq = events.length + 1
  for (const id of ['t1', 't2', 't3', 't4', 't5', 't6', 't7']) {
    events.push(ev({ altitude: 'L2', type: 'task', action: 'started', id }, seq++, at(21 * 60_000)))
    events.push(ev({ altitude: 'L2', type: 'task', action: 'done', id }, seq++, at(22 * 60_000)))
  }
  events.push(ev({ altitude: 'L2', type: 'task', action: 'started', id: 't8' }, seq++, at(23 * 60_000)))
  events.push(ev({ altitude: 'L2', type: 'task', action: 'failed', id: 't8' }, seq++, at(24 * 60_000)))
  events.push(ev({ altitude: 'L2', type: 'task', action: 'started', id: 't8' }, seq++, at(25 * 60_000)))
  events.push(ev({ altitude: 'L2', type: 'task', action: 'started', id: 't9' }, seq++, at(24 * 60_000)))
  events.push(ev({ altitude: 'L2', type: 'task', action: 'failed', id: 't9' }, seq++, at(25 * 60_000)))
  return { runId: 'armed-run', memo: liteMemo('armed-run', { updatedAt: at(25 * 60_000) }), events }
}

function runFixtured(runId: string, events: SddEvent[], memoOverrides: Partial<PersistedLite> = {}): RunFixture {
  const last = events[events.length - 1]
  return {
    runId,
    memo: liteMemo(runId, { updatedAt: last?.ts ?? at(60_000), ...memoOverrides }),
    events,
  }
}

function plainRun(runId: string, lastOffsetMs: number): RunFixture {
  return runFixtured(runId, walkThrough(['intake', 'draft'], 1, at(lastOffsetMs)))
}

function completedRun(runId: string, lastOffsetMs: number): RunFixture {
  return runFixtured(
    runId,
    [
      ...walkThrough(['intake', 'draft'], 1, at(1 * 60_000)),
      ev({ altitude: 'L2', type: 'stage_enter', stage: 'review' }, 5, at(2 * 60_000)),
      ev({ altitude: 'L2', type: 'round_open', round: 1, cap: 1 }, 6, at(2 * 60_000)),
      ev(
        {
          altitude: 'L2',
          type: 'convergence',
          round: 1,
          verdict: 'converged',
          counts: { blocker: 0, material: 0, nitpick: 0 },
        },
        7,
        at(3 * 60_000),
      ),
      ev({ altitude: 'L2', type: 'stage_exit', stage: 'review' }, 8, at(3 * 60_000)),
      ev({ altitude: 'L2', type: 'stage_enter', stage: 'gate' }, 9, at(4 * 60_000)),
      ev({ altitude: 'L2', type: 'gate', action: 'presented', mode: 'final', version: 1 }, 10, at(4 * 60_000)),
      ev({ altitude: 'L2', type: 'stage_exit', stage: 'gate' }, 11, at(5 * 60_000)),
      ev(
        { altitude: 'L2', type: 'gate', action: 'answered', mode: 'final', version: 1, outcome: 'approve' },
        12,
        at(lastOffsetMs),
      ),
    ],
    { status: 'completed' },
  )
}

function usageOf(inputTokens: number, costUsd: number): AgentUsage {
  return {
    inputTokens,
    outputTokens: 0,
    reasoningTokens: 0,
    cachedReadTokens: 0,
    cachedWriteTokens: 0,
    costUsd,
    wallMs: 0,
  }
}

function doneEvent(agent: string, seq: number, ts: string, tokens: number, costUsd: number): SddEvent {
  return ev({ altitude: 'L1', type: 'done', agent, usage: usageOf(tokens, costUsd) }, seq, ts)
}

function viewOf(fixture: RunFixture): ReturnType<typeof buildRunView> {
  return buildRunView({ ...fixture, now: NOW_MS })
}

describe('serve view-model — portfolio sort by attention', () => {
  it('a gate-pending run leads running and finished runs, carrying its gate mode and pending age', () => {
    const gate = viewOf(gatePendingRun())
    const running = viewOf(plainRun('running-run', 30 * 60_000))
    const finished = viewOf(completedRun('done-run', 40 * 60_000))
    const portfolio = buildPortfolio([finished, running, gate])
    expect(portfolio.cards.map((card) => card.runId)).toEqual(['gate-run', 'running-run', 'done-run'])
    expect(gate.attention).toBe('gate-pending')
    expect(gate.gate).toEqual({
      mode: 'escalation',
      version: 2,
      pendingAgeMs: NOW_MS - Date.parse(GATE_PRESENTED_TS),
      gateFile: 'gate-2.md',
    })
    expect(gate.status).toBe('gate:escalation v2')
    expect(finished.attention).toBe('finished')
    expect(finished.status).toBe('completed')
    expect(running.attention).toBe('running')
    expect(portfolio.totals).toEqual({
      runs: 3,
      gatePending: 1,
      running: 1,
      finished: 1,
      tokens: 0,
      costUsd: 0,
      unpricedCount: 0,
    })
  })

  it('gate-pending runs sort by longest wait first and running runs by last activity', () => {
    const earlyGate = viewOf(
      runFixtured(
        'gate-early',
        [ev({ altitude: 'L2', type: 'gate', action: 'presented', mode: 'early', version: 1 }, 1, at(1 * 60_000))],
        { gate: { mode: 'early', version: 1 } },
      ),
    )
    const lateGate = viewOf(
      runFixtured(
        'gate-late',
        [ev({ altitude: 'L2', type: 'gate', action: 'presented', mode: 'early', version: 3 }, 1, at(90 * 60_000))],
        { gate: { mode: 'early', version: 3 } },
      ),
    )
    const freshRun = viewOf(plainRun('run-fresh', 50 * 60_000))
    const staleRun = viewOf(plainRun('run-stale', 2 * 60_000))
    const portfolio = buildPortfolio([lateGate, staleRun, freshRun, earlyGate])
    expect(portfolio.cards.map((card) => card.runId)).toEqual(['gate-early', 'gate-late', 'run-fresh', 'run-stale'])
  })

  it('an empty board renders totals of zero instead of an error', () => {
    const portfolio = buildPortfolio([])
    expect(portfolio.cards).toEqual([])
    expect(portfolio.totals.runs).toBe(0)
    expect(portfolio.totals.unpricedCount).toBe(0)
  })
})

describe('serve view-model — the armed walk card', () => {
  it('a running execution-armed run shows the per-task progress line naming the retrying task', () => {
    const card = viewOf(armedRun())
    expect(card.status).toBe('exec:implement')
    expect(card.taskProgress).toEqual({ done: 7, total: 9, retrying: ['t8'], failed: ['t9'] })
    expect(card.attention).toBe('running')
    expect(card.stage).toBe('implement')
  })

  it('an unarmed run renders no task progress line', () => {
    const card = viewOf(plainRun('plain-run', 1 * 60_000))
    expect(card.taskProgress).toBeNull()
  })
})

describe('serve view-model — spend is tokens-first with honest cost bounds', () => {
  it('a priced run renders tokens and cost as a lower bound; an unpriced run counts in the totals', () => {
    const priced = viewOf(
      runFixtured('priced-run', [
        doneEvent('impl', 1, at(2 * 60_000), 900, 0.25),
        doneEvent('impl', 2, at(3 * 60_000), 300, 0.1),
      ]),
    )
    const unpriced = viewOf(runFixtured('unpriced-run', [doneEvent('impl', 1, at(1 * 60_000), 4_200, 0)]))
    expect(priced.spend).toEqual({ tokens: 1_200, costUsd: 0.35, costKnown: true })
    expect(unpriced.spend).toEqual({ tokens: 4_200, costUsd: 0, costKnown: false })
    const portfolio = buildPortfolio([priced, unpriced])
    expect(portfolio.totals.tokens).toBe(5_400)
    expect(portfolio.totals.costUsd).toBe(0.35)
    expect(portfolio.totals.unpricedCount).toBe(1)
  })

  it('a degraded row (unreadable log) is unpriced and keeps its memo identity', () => {
    const memo = liteMemo('degraded-run', { gate: { mode: 'final', version: 1 } })
    const card = buildRunView({ runId: 'degraded-run', memo, events: null, now: NOW_MS })
    expect(card.attention).toBe('gate-pending')
    expect(card.status).toBe('gate:final v1')
    expect(card.spend).toEqual({ tokens: null, costUsd: null, costKnown: false })
    expect(card.lastActivity).toBe(memo.updatedAt)
    expect(card.wallMs).toBeNull()
    expect(buildPortfolio([card]).totals.unpricedCount).toBe(1)
  })
})

describe('serve view-model — the run detail projection', () => {
  it('renders position, per-round raised/open history, and the pending gate file read-only', () => {
    const events = [
      ...walkThrough(['intake', 'draft'], 1, at(1 * 60_000)),
      ev({ altitude: 'L2', type: 'stage_enter', stage: 'review' }, 5, at(2 * 60_000)),
      ev({ altitude: 'L2', type: 'round_open', round: 1, cap: 3 }, 6, at(2 * 60_000)),
      ev(
        {
          altitude: 'L2',
          type: 'convergence',
          round: 1,
          verdict: 'open',
          counts: { blocker: 1, material: 2, nitpick: 3 },
          open: { blocker: 1, material: 0, nitpick: 1 },
        },
        7,
        at(3 * 60_000),
      ),
      ev({ altitude: 'L2', type: 'round_open', round: 2, cap: 3 }, 8, at(4 * 60_000)),
      ev(
        {
          altitude: 'L2',
          type: 'convergence',
          round: 2,
          verdict: 'converged',
          counts: { blocker: 0, material: 1, nitpick: 1 },
          open: { blocker: 0, material: 1, nitpick: 0 },
        },
        9,
        at(5 * 60_000),
      ),
      ev({ altitude: 'L2', type: 'gate', action: 'presented', mode: 'final', version: 2 }, 10, at(6 * 60_000)),
    ]
    const detail = buildRunDetail({
      ...runFixtured('detail-run', events, { gate: { mode: 'final', version: 2 } }),
      now: NOW_MS,
      gateContent: '## Final gate\n→ <answer or OVERRIDE>',
    })
    expect(detail.position).toBe('gate.awaiting')
    expect(detail.stages['review']).toBe('active')
    expect(detail.round).toEqual({ current: 2, cap: 3 })
    expect(detail.rounds).toEqual([
      {
        round: 1,
        verdict: 'open',
        raised: { blocker: 1, material: 2, nitpick: 3 },
        open: { blocker: 1, material: 0, nitpick: 1 },
      },
      {
        round: 2,
        verdict: 'converged',
        raised: { blocker: 0, material: 1, nitpick: 1 },
        open: { blocker: 0, material: 1, nitpick: 0 },
      },
    ])
    expect(detail.gate).toEqual({
      mode: 'final',
      version: 2,
      file: 'gate-2.md',
      content: '## Final gate\n→ <answer or OVERRIDE>',
    })
    expect(detail.recentEvents.length).toBeLessThanOrEqual(RECENT_EVENT_LIMIT)
    const last = detail.recentEvents[detail.recentEvents.length - 1]
    expect(last).toMatchObject({ seq: 10, ts: at(6 * 60_000) })
    expect(last?.summary).toContain('gate presented final v2')
  })

  it('renders the per-task walk with attempt counts for armed runs', () => {
    const events = [...armedPrefix(1, at(1 * 60_000))]
    let seq = events.length + 1
    events.push(ev({ altitude: 'L2', type: 'task', action: 'started', id: 't1' }, seq++, at(2 * 60_000)))
    events.push(ev({ altitude: 'L2', type: 'task', action: 'done', id: 't1' }, seq++, at(3 * 60_000)))
    events.push(ev({ altitude: 'L2', type: 'task', action: 'started', id: 't2' }, seq++, at(3 * 60_000)))
    events.push(ev({ altitude: 'L2', type: 'task', action: 'failed', id: 't2' }, seq++, at(4 * 60_000)))
    events.push(ev({ altitude: 'L2', type: 'task', action: 'started', id: 't2' }, seq++, at(5 * 60_000)))
    const detail = buildRunDetail({
      ...runFixtured('walk-run', events),
      now: NOW_MS,
      gateContent: null,
    })
    expect(detail.tasks).toEqual([
      { id: 't1', status: 'done', attempts: 1 },
      { id: 't2', status: 'running', attempts: 2 },
    ])
    expect(detail.gate).toBeNull()
  })

  it('a terminal run renders no pending gate and keeps its rounds', () => {
    const fixture = completedRun('done-run', 5 * 60_000)
    const detail = buildRunDetail({ ...fixture, now: NOW_MS, gateContent: 'stale gate text' })
    expect(detail.attention).toBe('finished')
    expect(detail.gate).toBeNull()
    expect(detail.position).toBe('completed')
    expect(detail.rounds).toHaveLength(1)
  })
})

describe('serve view-model — the fs shells over a real work dir', () => {
  const tmpDirs: string[] = []

  afterEach(() => {
    while (tmpDirs.length > 0) {
      const dir = tmpDirs.pop()
      if (dir !== undefined) fs.rmSync(dir, { recursive: true, force: true })
    }
  })

  function makeWorkDir(prefix: string): string {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), prefix))
    tmpDirs.push(dir)
    return dir
  }

  function writeRunDir(workDir: string, runId: string, lines: readonly string[], memo: PersistedLite): string {
    const runDir = path.join(workDir, 'runs', runId)
    fs.mkdirSync(runDir, { recursive: true })
    fs.writeFileSync(path.join(runDir, 'events.ndjson'), `${lines.join('\n')}\n`)
    fs.writeFileSync(
      path.join(runDir, 'state.json'),
      `${JSON.stringify({ workDir, stage: 'review', depth: 'S', round: 1, createdAt: memo.updatedAt, ...memo }, null, 2)}\n`,
    )
    return runDir
  }

  it('an empty work dir folds to an empty board', async () => {
    const workDir = makeWorkDir('afk-board-empty-')
    const portfolio = await loadPortfolio(workDir, NOW)
    expect(portfolio.cards).toEqual([])
    expect(portfolio.totals.runs).toBe(0)
  })

  it('a torn final log line folds as absent and the view stays valid', async () => {
    const workDir = makeWorkDir('afk-board-torn-')
    writeRunDir(
      workDir,
      'torn-run',
      [
        ...walkThrough(['intake'], 1, at(1 * 60_000)).map((event) => JSON.stringify(event)),
        // the in-flight append: a partially written final line
        '{"altitude":"L2","type":"gate","ac',
      ],
      liteMemo('torn-run'),
    )
    const portfolio = await loadPortfolio(workDir, NOW)
    expect(portfolio.totals.runs).toBe(1)
    const card = portfolio.cards[0]
    expect(card?.attention).toBe('running')
    expect(card?.stage).toBe('intake')
  })

  it('the detail shell reads the pending gate file through the read-only seam; unknown runs miss', async () => {
    const workDir = makeWorkDir('afk-board-detail-')
    const gateEvents = [
      ...walkThrough(['intake', 'draft'], 1, at(1 * 60_000)),
      ev({ altitude: 'L2', type: 'stage_enter', stage: 'review' }, 5, at(2 * 60_000)),
      ev({ altitude: 'L2', type: 'gate', action: 'presented', mode: 'early', version: 1 }, 6, at(3 * 60_000)),
    ]
    const runDir = writeRunDir(
      workDir,
      'detail-run',
      gateEvents.map((event) => JSON.stringify(event)),
      { ...liteMemo('detail-run'), gate: { mode: 'early', version: 1 }, updatedAt: at(3 * 60_000) },
    )
    fs.writeFileSync(path.join(runDir, 'gate-1.md'), '## Early gate\n')
    const detail = await loadRunDetail(nodeServeFs(), workDir, 'detail-run', NOW)
    expect(detail).not.toBeNull()
    expect(detail?.gate).toEqual({ mode: 'early', version: 1, file: 'gate-1.md', content: '## Early gate\n' })
    expect(detail?.position).toBe('gate.awaiting')
    expect(await loadRunDetail(nodeServeFs(), workDir, 'no-such-run', NOW)).toBeNull()
  })
})
