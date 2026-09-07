// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

import { describe, expect, it } from 'bun:test'

import { ExecutionEvent, TaskEvent } from '../../afk-runner/src/execution-schemas.js'

describe('execution-walk event schemas (U3 D1/D4, extraction seam)', () => {
  it('the armed fact parses with exactly its action; anything else rejects', () => {
    expect(ExecutionEvent.parse({ altitude: 'L2', type: 'execution', action: 'armed' })).toMatchObject({
      type: 'execution',
      action: 'armed',
    })
    expect(ExecutionEvent.safeParse({ altitude: 'L2', type: 'execution', action: 'disarmed' }).success).toBe(false)
    expect(ExecutionEvent.safeParse({ altitude: 'L1', type: 'execution', action: 'armed' }).success).toBe(false)
  })

  it('task events parse for every walk action, carry optional detail, and reject the rest', () => {
    for (const action of ['started', 'done', 'failed'] as const) {
      expect(TaskEvent.parse({ altitude: 'L2', type: 'task', action, id: '2' })).toMatchObject({
        type: 'task',
        action,
        id: '2',
      })
    }
    expect(
      TaskEvent.parse({ altitude: 'L2', type: 'task', action: 'failed', id: '2', detail: 'verify red' }),
    ).toMatchObject({ detail: 'verify red' })
    expect(TaskEvent.safeParse({ altitude: 'L2', type: 'task', action: 'done' }).success).toBe(false)
    expect(TaskEvent.safeParse({ altitude: 'L2', type: 'task', action: 'skipped', id: '1' }).success).toBe(false)
    expect(TaskEvent.safeParse({ altitude: 'L2', type: 'task', action: 'done', id: '' }).success).toBe(false)
  })
})
