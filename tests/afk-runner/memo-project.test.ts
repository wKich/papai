// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

import { describe, expect, it } from 'bun:test'

import { stampEvent } from '../../afk-runner/src/events.js'
import type { EventInput, SddEvent } from '../../afk-runner/src/events.js'
import { pipelineMachine } from '../../afk-runner/src/graph/pipeline.js'
import { foldEvents } from '../../afk-runner/src/kernel/fold.js'
import { memoFieldsOf } from '../../afk-runner/src/memo-project.js'
import type { MemoFields } from '../../afk-runner/src/memo-project.js'
import { PersistedRunStateSchema } from '../../afk-runner/src/run-state.js'

function stampAll(inputs: readonly EventInput[]): SddEvent[] {
  return inputs.map((input, index) => stampEvent(input, index + 1, '2026-09-03T00:00:00.000Z'))
}

describe('memoFieldsOf — release-mode gate records (U3 D7)', () => {
  const WALK: readonly EventInput[] = [
    { altitude: 'L2', type: 'stage_enter', stage: 'intake' },
    { altitude: 'L2', type: 'depth', profile: 'S', rationale: 'r', source: 'estimator' },
    { altitude: 'L2', type: 'stage_exit', stage: 'intake' },
  ]

  it('a run parked at a release gate memos running with the release gate record', () => {
    const events = stampAll([
      ...WALK,
      { altitude: 'L2', type: 'gate', action: 'presented', mode: 'release', version: 2 },
    ])
    const snapshot = foldEvents(pipelineMachine, events).snapshot
    const memo = memoFieldsOf(events, snapshot.context, 'gate-pending', 'gate.awaiting')
    // The typed expectation is the point: `mode: 'release'` must be a legal
    // memo gate record, or this file fails typecheck (CI's typecheck leg).
    const expected: MemoFields['gate'] = { mode: 'release', version: 2 }
    expect(memo.status).toBe('running')
    expect(memo.gate).toEqual(expected)
  })
})

describe('memoFieldsOf — tasks projection carries item text additively (afk-runner-task-todos D2)', () => {
  const WALK: readonly EventInput[] = [
    { altitude: 'L2', type: 'stage_enter', stage: 'intake' },
    { altitude: 'L2', type: 'execution', action: 'armed' },
    { altitude: 'L2', type: 'stage_enter', stage: 'implement' },
  ]

  it("a parking run's memo tasks projection carries each item's text beside status/attempts", () => {
    const events = stampAll([
      ...WALK,
      { altitude: 'L2', type: 'task', action: 'started', id: '1', detail: 'Fix the chunking fallback' },
      { altitude: 'L2', type: 'task', action: 'done', id: '1' },
      { altitude: 'L2', type: 'task', action: 'started', id: '2', detail: 'second item' },
    ])
    const snapshot = foldEvents(pipelineMachine, events).snapshot
    const memo = memoFieldsOf(events, snapshot.context, 'gate-pending', 'gate.awaiting')
    expect(memo.tasks).toEqual({
      '1': { status: 'done', attempts: 1, text: 'Fix the chunking fallback' },
      '2': { status: 'running', attempts: 1, text: 'second item' },
    })
  })

  it('a pre-change tasks record (no text field) still validates through the memo schema', () => {
    const preChange = {
      runId: 'r1',
      repoRoot: '/repo',
      workDir: '/repo/.sdd-runner',
      changeName: 'add-thing',
      stage: 'implement',
      depth: null,
      round: 0,
      gate: null,
      status: 'running',
      createdAt: '2026-09-03T00:00:00.000Z',
      updatedAt: '2026-09-03T00:00:00.000Z',
      tasks: { '1': { status: 'done', attempts: 1 } },
    }
    expect(PersistedRunStateSchema.safeParse(preChange).success).toBe(true)
    const withText = { ...preChange, tasks: { '1': { status: 'done', attempts: 1, text: 'item text' } } }
    // the memo write round-trips through PersistedRunStateSchema.parse — the
    // text must survive that parse, not merely be tolerated by it
    const parsed = PersistedRunStateSchema.parse(withText)
    expect(parsed.tasks?.['1']).toEqual({ status: 'done', attempts: 1, text: 'item text' })
  })
})
