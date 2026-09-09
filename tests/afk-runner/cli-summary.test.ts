// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

import { describe, expect, it } from 'bun:test'
import fs from 'node:fs'
import path from 'node:path'

import { fullStateSummary, runCli } from '../../afk-runner/src/cli-summary.js'
import { startRun, statusRun } from '../../afk-runner/src/run.js'
import { BLOCKER_ROUND, TASK_TEXT, makeFakePipeline } from './fixtures/fake-pipeline.js'

const FIXTURE_RUN = path.join(import.meta.dir, 'fixtures', 'real', '2026-08-21T19-44-19-770Z-2f6e644a')

/** The first run id under a fake pipeline's work dir. */
function firstRunOf(pipeline: ReturnType<typeof makeFakePipeline>): string {
  const entries = fs.readdirSync(path.join(pipeline.workDir, 'runs'))
  return entries[0] ?? ''
}

describe('afk-runner cli fold summary (runCli)', () => {
  it('prints a folded state summary with mapped/tolerated accounting for a run dir', () => {
    const summary = runCli([FIXTURE_RUN])
    expect(summary).toContain('value: completed')
    expect(summary).toContain('intake: done')
    expect(summary).toContain('gate: done')
    expect(summary).toContain('events: 886 (mapped 68, tolerated 818)')
  })

  it('exits with a usage error when no run dir is given', () => {
    expect(() => runCli([])).toThrow('usage: afk-runner <runDir>')
  })

  it('exits with a clear error for a run dir without events.ndjson', () => {
    expect(() => runCli([import.meta.dir])).toThrow('events.ndjson not found')
  })

  it('bare-arg miss error names the replacement verbs', () => {
    expect(() => runCli([import.meta.dir])).toThrow('start <taskFile>')
    expect(() => runCli([import.meta.dir])).toThrow('resume <runId>')
  })
})

describe('afk-runner cli full-state summary (fullStateSummary)', () => {
  it('renders the gate-pending flavor from folded context', async () => {
    const pipeline = makeFakePipeline({ sidecarOverrides: BLOCKER_ROUND })
    await startRun(pipeline.deps, { taskText: TASK_TEXT })
    const runId = firstRunOf(pipeline)
    const status = await statusRun(pipeline.deps, runId)
    const lines = fullStateSummary(status)
    expect(lines).toContain('gate: early v1 awaiting')
    expect(lines).toContain('halted: gate-pending')
  })
})
