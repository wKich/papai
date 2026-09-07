// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

import { afterEach, describe, expect, it } from 'bun:test'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'

import type { GateAnswerForensic, GateNeverAnswered } from '../../afk-runner/src/analyze-gates.js'
import { gateForensics } from '../../afk-runner/src/analyze-gates.js'
import { loadRunBundle, nodeAnalyzeFs } from '../../afk-runner/src/analyze-io.js'

const tmpDirs: string[] = []
const T0 = '2026-09-03T09:00:00.000Z'
const NOW = new Date('2026-09-03T10:00:00.000Z')

function makeDir(): string {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'afk-analyze-gates-'))
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
    mode: 'release',
    version,
    ...(outcome === undefined ? {} : { outcome }),
    seq,
    ts,
  })
}

function writeReleaseRun(workDir: string, runId: string, events: readonly string[]): string {
  const runDir = path.join(workDir, 'runs', runId)
  fs.mkdirSync(runDir, { recursive: true })
  fs.writeFileSync(path.join(runDir, 'events.ndjson'), `${events.join('\n')}\n`)
  return runDir
}

describe('analyze-gates — release-mode gates read like any gate (U3 D7)', () => {
  it('attributes a human-settled release gate with its mode intact', async () => {
    const workDir = makeDir()
    writeReleaseRun(workDir, 'release-run', [
      gateLine('presented', 1, 1, T0),
      gateLine('answered', 1, 2, at(120_000), 'approve'),
    ])
    const bundle = await loadRunBundle(nodeAnalyzeFs(), workDir, 'release-run')
    // The typed expectation is the point: `mode: 'release'` must be a legal
    // GateAnswerForensic, or this file fails typecheck (CI's typecheck leg).
    const expected: GateAnswerForensic = {
      version: 1,
      mode: 'release',
      latencyMs: 120_000,
      settledBy: 'human',
      rule: null,
    }
    expect(gateForensics(bundle, NOW)).toMatchObject({ status: 'known', value: { answered: [expected] } })
  })

  it('a never-answered release gate carries its age with its mode', async () => {
    const workDir = makeDir()
    writeReleaseRun(workDir, 'release-pending', [gateLine('presented', 2, 1, T0)])
    const bundle = await loadRunBundle(nodeAnalyzeFs(), workDir, 'release-pending')
    const expected: GateNeverAnswered = { version: 2, mode: 'release', ageMs: 3_600_000 }
    expect(gateForensics(bundle, NOW)).toMatchObject({ status: 'known', value: { neverAnswered: [expected] } })
  })
})
