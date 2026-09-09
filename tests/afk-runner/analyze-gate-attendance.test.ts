// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

import { afterEach, describe, expect, it } from 'bun:test'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'

import type { AttendanceAnsweredRow } from '../../afk-runner/src/analyze-attendance.js'
import { gateAttendance } from '../../afk-runner/src/analyze-attendance.js'
import { buildCorpusReport } from '../../afk-runner/src/analyze-corpus.js'
import { loadCorpus, loadRunBundle, nodeAnalyzeFs } from '../../afk-runner/src/analyze-io.js'
import { renderCorpusJson, renderCorpusReport } from '../../afk-runner/src/analyze-report.js'

/**
 * Gate attendance forensics (afk-runner-service Phase 0): settle-origin
 * attribution joined with presented→answered wait latency. The five
 * attendance shapes — human, policy (record before the answer), waiter
 * (record after), never-answered pending, unjoinable answered — over
 * synthetic minimal run dirs shaped from the committed corpus.
 */

const tmpDirs: string[] = []
const T0 = '2026-09-03T09:00:00.000Z'
const NOW = new Date('2026-09-03T10:00:00.000Z')

function makeDir(): string {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'afk-attendance-'))
  tmpDirs.push(dir)
  return dir
}

afterEach(() => {
  while (tmpDirs.length > 0) {
    const dir = tmpDirs.pop()
    if (dir !== undefined) fs.rmSync(dir, { recursive: true, force: true })
  }
})

function at(ms: number): string {
  return new Date(Date.parse(T0) + ms).toISOString()
}

function gateLine(
  action: 'presented' | 'answered',
  version: number,
  seq: number,
  ts: string,
  outcome?: string,
): string {
  return JSON.stringify({
    altitude: 'L2',
    type: 'gate',
    action,
    mode: 'early',
    version,
    ...(outcome === undefined ? {} : { outcome }),
    seq,
    ts,
  })
}

function autoDecisionLine(rule: string, decision: string, gateVersion: number, seq: number, ts: string): string {
  return JSON.stringify({
    altitude: 'L2',
    type: 'auto_decision',
    rule,
    decision,
    evidenceDigest: `digest-${seq}`,
    gateVersion,
    seq,
    ts,
  })
}

function writeRun(workDir: string, runId: string, events: readonly string[]): string {
  const runDir = path.join(workDir, 'runs', runId)
  fs.mkdirSync(runDir, { recursive: true })
  fs.writeFileSync(path.join(runDir, 'events.ndjson'), `${events.join('\n')}\n`)
  return runDir
}

/** The four-gates fixture: three human-settled answers and one never-answered pending gate. */
function fourGatesWorkDir(): string {
  const workDir = makeDir()
  writeRun(workDir, 'four-gates', [
    gateLine('presented', 1, 1, T0),
    gateLine('answered', 1, 2, at(120_000), 'approve'),
    gateLine('presented', 2, 3, at(200_000)),
    gateLine('answered', 2, 4, at(440_000), 'approve'),
    gateLine('presented', 3, 5, at(500_000)),
    gateLine('answered', 3, 6, at(980_000), 'approve'),
    gateLine('presented', 4, 7, at(1_000_000)),
  ])
  return workDir
}

describe('analyze-attendance — per-gate origin attribution with the wait-latency join', () => {
  it('attributes human, policy (record before), and waiter (record after) with their waits', async () => {
    const workDir = makeDir()
    writeRun(workDir, 'drama', [
      // v1 human: answered with no settle-kind auto_decision
      gateLine('presented', 1, 1, T0),
      gateLine('answered', 1, 2, at(120_000), 'approve'),
      // v2 policy: the prelude's record precedes the answered event
      gateLine('presented', 2, 3, at(200_000)),
      autoDecisionLine('R1', 'approve', 2, 4, at(300_000)),
      gateLine('answered', 2, 5, at(320_000), 'approve'),
      // v3 waiter: the record follows the answered event
      gateLine('presented', 3, 6, at(400_000)),
      gateLine('answered', 3, 7, at(560_000), 'extend'),
      autoDecisionLine('R2', 'extend', 3, 8, at(560_000)),
    ])
    const bundle = await loadRunBundle(nodeAnalyzeFs(), workDir, 'drama')
    const expected: readonly AttendanceAnsweredRow[] = [
      { version: 1, mode: 'early', origin: 'human', waitMs: 120_000 },
      { version: 2, mode: 'early', origin: 'policy', waitMs: 120_000 },
      { version: 3, mode: 'early', origin: 'waiter', waitMs: 160_000 },
    ]
    expect(gateAttendance(bundle, NOW)).toMatchObject({
      status: 'known',
      value: { answered: expected, pending: [], unknown: [] },
    })
  })

  it('a never-answered gate is listed as pending with its age, never dropped', async () => {
    const workDir = makeDir()
    writeRun(workDir, 'pending', [gateLine('presented', 4, 1, at(1_000_000))])
    const bundle = await loadRunBundle(nodeAnalyzeFs(), workDir, 'pending')
    expect(gateAttendance(bundle, NOW)).toMatchObject({
      status: 'known',
      value: { pending: [{ version: 4, mode: 'early', ageMs: 2_600_000 }] },
    })
  })

  it('an answered gate whose presentation record is absent degrades to unknown with its reason', async () => {
    const workDir = makeDir()
    // the presented line was torn (unparsable, dropped at load) — only the answer survived
    writeRun(workDir, 'torn', ['{"garbage":', gateLine('answered', 5, 2, at(60_000), 'approve')])
    const bundle = await loadRunBundle(nodeAnalyzeFs(), workDir, 'torn')
    expect(gateAttendance(bundle, NOW)).toMatchObject({
      status: 'known',
      value: {
        unknown: [{ version: 5, reason: 'no presentation record' }],
        answered: [],
        pending: [],
      },
    })
  })

  it('an answered gate whose presentation timestamp is unparsable degrades to unknown too', async () => {
    const workDir = makeDir()
    writeRun(workDir, 'torn-ts', [
      gateLine('presented', 1, 1, 'not-a-timestamp'),
      gateLine('answered', 1, 2, at(60_000), 'approve'),
    ])
    const bundle = await loadRunBundle(nodeAnalyzeFs(), workDir, 'torn-ts')
    expect(gateAttendance(bundle, NOW)).toMatchObject({
      status: 'known',
      value: { unknown: [{ version: 1, reason: 'unparsable presentation timestamp' }] },
    })
  })

  it('a run with no gate events reports attendance unknown with its reason', async () => {
    const workDir = makeDir()
    writeRun(workDir, 'gateless', [
      JSON.stringify({ altitude: 'L2', type: 'stage_enter', stage: 'intake', seq: 1, ts: T0 }),
    ])
    const bundle = await loadRunBundle(nodeAnalyzeFs(), workDir, 'gateless')
    expect(gateAttendance(bundle, NOW)).toEqual({ status: 'unknown', reason: 'no gate events' })
  })
})

describe('analyze-attendance — corpus aggregate', () => {
  it('reports the human-settle rate over answered gates with pending and unknown beside it', async () => {
    const workDir = fourGatesWorkDir()
    const bundles = await loadCorpus(nodeAnalyzeFs(), [workDir])
    const report = buildCorpusReport(bundles, [], { now: NOW })
    expect(report.aggregates.gateAttendance).toEqual({
      answered: 3,
      human: 3,
      policy: 0,
      waiter: 0,
      humanSettleRate: 1,
      humanWaitMedianMs: 240_000,
      humanWaitUpperBoundMs: 480_000,
      pendingGates: 1,
      unknownGates: 0,
    })
  })

  it('mixed origins price the split: rate over answered, median and upper bound over human waits only', async () => {
    const workDir = makeDir()
    writeRun(workDir, 'mixed', [
      // human, 2 minutes
      gateLine('presented', 1, 1, T0),
      gateLine('answered', 1, 2, at(120_000), 'approve'),
      // policy, 1 minute
      gateLine('presented', 2, 3, at(200_000)),
      autoDecisionLine('R1', 'approve', 2, 4, at(240_000)),
      gateLine('answered', 2, 5, at(260_000), 'approve'),
      // human, 6 minutes
      gateLine('presented', 3, 6, at(400_000)),
      gateLine('answered', 3, 7, at(760_000), 'approve'),
      // human, 10 minutes
      gateLine('presented', 4, 8, at(800_000)),
      gateLine('answered', 4, 9, at(1_400_000), 'approve'),
    ])
    const bundles = await loadCorpus(nodeAnalyzeFs(), [workDir])
    const report = buildCorpusReport(bundles, [], { now: NOW })
    expect(report.aggregates.gateAttendance).toMatchObject({
      answered: 4,
      human: 3,
      policy: 1,
      waiter: 0,
      humanSettleRate: 0.75,
      humanWaitMedianMs: 360_000,
      humanWaitUpperBoundMs: 600_000,
      pendingGates: 0,
      unknownGates: 0,
    })
  })

  it('an unjoinable gate stays in the answered denominator — the rate reports reduced coverage, never hides it', async () => {
    const workDir = makeDir()
    writeRun(workDir, 'reduced', [
      gateLine('presented', 1, 1, T0),
      gateLine('answered', 1, 2, at(120_000), 'approve'),
      // answered over a presentation record whose timestamp is torn — joinable
      // never (no era signature), answered still
      gateLine('presented', 2, 3, 'not-a-timestamp'),
      gateLine('answered', 2, 4, at(180_000), 'approve'),
    ])
    const bundles = await loadCorpus(nodeAnalyzeFs(), [workDir])
    const report = buildCorpusReport(bundles, [], { now: NOW })
    expect(report.aggregates.gateAttendance).toMatchObject({
      answered: 2,
      human: 1,
      humanSettleRate: 0.5,
      unknownGates: 1,
    })
  })

  it('era-contaminated runs are excluded from the aggregate but keep their per-run unknown rows', async () => {
    const workDir = fourGatesWorkDir()
    writeRun(workDir, 'torn', ['{"garbage":', gateLine('answered', 9, 2, at(60_000), 'approve')])
    const bundles = await loadCorpus(nodeAnalyzeFs(), [workDir])
    const report = buildCorpusReport(bundles, [], { now: NOW })
    expect(report.aggregates.eraContaminated).toEqual(['torn'])
    expect(report.aggregates.gateAttendance).toMatchObject({ answered: 3, human: 3, unknownGates: 0 })
    const torn = report.runs.find((run) => run.runId === 'torn')
    expect(torn?.attendance).toMatchObject({
      status: 'known',
      value: { unknown: [{ version: 9, reason: 'no presentation record' }] },
    })
  })

  it('a corpus with no attendance-bearing clean runs reports the aggregate null', async () => {
    const workDir = makeDir()
    writeRun(workDir, 'gateless', [
      JSON.stringify({ altitude: 'L2', type: 'stage_enter', stage: 'intake', seq: 1, ts: T0 }),
    ])
    const bundles = await loadCorpus(nodeAnalyzeFs(), [workDir])
    const report = buildCorpusReport(bundles, [], { now: NOW })
    expect(report.aggregates.gateAttendance).toBeNull()
  })
})

describe('analyze-attendance — report rendering', () => {
  it('renders the attendance line per run and the aggregate beside never-answered gates, no ANSI', async () => {
    const workDir = fourGatesWorkDir()
    const bundles = await loadCorpus(nodeAnalyzeFs(), [workDir])
    const report = buildCorpusReport(bundles, [], { now: NOW })
    const text = renderCorpusReport(report)
    expect(text).toContain('attendance:')
    expect(text).toContain('human 3')
    expect(text).toContain('pending v4')
    expect(text).toContain('gate attendance: human 3/3')
    expect(text).toContain('median 4m')
    expect(text).toContain('pending 1')
    expect(text).not.toContain('\u001b[')
  })

  it('--json carries per-gate rows and the aggregate machine-readably', async () => {
    const workDir = fourGatesWorkDir()
    const bundles = await loadCorpus(nodeAnalyzeFs(), [workDir])
    const report = buildCorpusReport(bundles, [], { now: NOW })
    const parsed: unknown = JSON.parse(renderCorpusJson(report))
    expect(parsed).toMatchObject({
      runs: [
        {
          attendance: {
            status: 'known',
            value: {
              answered: [
                { version: 1, mode: 'early', origin: 'human', waitMs: 120_000 },
                { version: 2, mode: 'early', origin: 'human', waitMs: 240_000 },
                { version: 3, mode: 'early', origin: 'human', waitMs: 480_000 },
              ],
              pending: [{ version: 4, mode: 'early', ageMs: 2_600_000 }],
            },
          },
        },
      ],
      aggregates: {
        gateAttendance: { humanSettleRate: 1, humanWaitMedianMs: 240_000, pendingGates: 1 },
      },
    })
  })
})
