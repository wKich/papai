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
