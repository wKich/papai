// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

import { afterEach, describe, expect, it } from 'bun:test'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'

import { readEvents } from '../../../afk-runner/src/events.js'
import type { SddEvent } from '../../../afk-runner/src/events.js'
import { executionBlockLines } from '../../../afk-runner/src/work/report-execution.js'

const T0 = '2026-01-01T00:00:00.000Z'
const tmpDirs: string[] = []

afterEach(() => {
  while (tmpDirs.length > 0) {
    const dir = tmpDirs.pop()
    if (dir !== undefined) fs.rmSync(dir, { recursive: true, force: true })
  }
})

/** Read inputs through a temp log so the events carry real schema stamps. */
function eventsOf(inputs: readonly object[]): readonly SddEvent[] {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'afk-report-exec-'))
  tmpDirs.push(dir)
  const logPath = path.join(dir, 'events.ndjson')
  fs.writeFileSync(
    logPath,
    `${inputs.map((input, index) => JSON.stringify({ ...input, seq: index + 1, ts: T0 })).join('\n')}\n`,
  )
  return readEvents(logPath)
}

const ARMED_WALK: readonly object[] = [
  { altitude: 'L2', type: 'execution', action: 'armed' },
  { altitude: 'L2', type: 'task', action: 'started', id: '1' },
  { altitude: 'L2', type: 'task', action: 'done', id: '1' },
  { altitude: 'L2', type: 'task', action: 'started', id: '2' },
  { altitude: 'L2', type: 'task', action: 'failed', id: '2' },
  { altitude: 'L2', type: 'task', action: 'started', id: '2' },
  { altitude: 'L2', type: 'gate', action: 'presented', mode: 'release', version: 2 },
  { altitude: 'L2', type: 'gate', action: 'answered', mode: 'release', version: 2, outcome: 'approve' },
]

describe('executionBlockLines (U3 D9 — the report execution facts)', () => {
  it('renders tasks, verify outcomes, and the release version with its outcome on an armed walk', () => {
    const lines = executionBlockLines(eventsOf(ARMED_WALK), [
      { log: 'verify-1', verdict: 'red' as const },
      { log: 'verify-2', verdict: 'green' as const },
    ])
    expect(lines).toEqual(['tasks: 1/2 done', 'verify: verify-1 red, verify-2 green', 'release: v2 approve'])
  })

  it('renders a pending release when the gate was presented but never answered', () => {
    const parked = ARMED_WALK.slice(0, -1)
    const lines = executionBlockLines(eventsOf(parked), [])
    expect(lines).toEqual(['tasks: 1/2 done', 'release: v2 pending'])
  })

  it('an unarmed log renders no block and an armed log with nothing walked renders none either', () => {
    const unarmed: readonly object[] = [
      { altitude: 'L2', type: 'stage_enter', stage: 'intake' },
      { altitude: 'L2', type: 'task', action: 'done', id: '9' },
    ]
    expect(executionBlockLines(eventsOf(unarmed), [{ log: 'verify-1', verdict: 'green' as const }])).toEqual([])
    const armedIdle: readonly object[] = [{ altitude: 'L2', type: 'execution', action: 'armed' }]
    expect(executionBlockLines(eventsOf(armedIdle), [])).toEqual([])
  })
})
