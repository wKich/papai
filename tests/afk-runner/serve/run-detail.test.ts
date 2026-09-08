// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

import { describe, expect, it } from 'bun:test'

import type { EventInput, SddEvent } from '../../../afk-runner/src/events.js'
import { stampEvent } from '../../../afk-runner/src/events.js'
import type { PersistedLite } from '../../../afk-runner/src/run-lite.js'
import { RECENT_EVENT_LIMIT, buildRunDetail } from '../../../afk-runner/src/serve/run-detail.js'

/**
 * The run-detail projection's todo surface (board-todos spec): the agent
 * todos panel input — last snapshot per agent, most-recent first — and the
 * recent-events feed that stays full of the run's other activity while
 * todo telemetry is excluded. Pure projection; the fs shells ride
 * view-model.test.ts's real work dirs.
 */

const NOW_MS = Date.parse('2026-09-01T12:00:00.000Z')

function at(offsetMs: number): string {
  return new Date(Date.parse('2026-09-01T00:00:00.000Z') + offsetMs).toISOString()
}

function ev(init: EventInput, seq: number, ts: string): SddEvent {
  return stampEvent(init, seq, ts)
}

function todoSnapshot(
  agent: string,
  seq: number,
  ts: string,
  todos: readonly { readonly content: string; readonly status: string }[],
): SddEvent {
  return ev({ altitude: 'L0', type: 'agent_todos', agent, todos: [...todos] }, seq, ts)
}

function liteMemo(runId: string): PersistedLite {
  return {
    runId,
    status: 'running',
    gate: null,
    changeName: runId,
    updatedAt: at(60_000),
  }
}

function detailOf(events: readonly SddEvent[], runId = 'todo-run'): ReturnType<typeof buildRunDetail> {
  return buildRunDetail({ runId, memo: liteMemo(runId), events, now: NOW_MS, gateContent: null })
}

describe('serve run-detail — the agent todos projection', () => {
  it('projects each agent’s last snapshot, most-recent first, stamped with that snapshot’s ts', () => {
    const events = [
      ev({ altitude: 'L2', type: 'stage_enter', stage: 'implement' }, 1, at(1 * 60_000)),
      todoSnapshot('implement-t2', 2, at(2 * 60_000), [{ content: 'write the failing test', status: 'pending' }]),
      todoSnapshot('resolver-r1', 3, at(3 * 60_000), [{ content: 'settle the gate', status: 'pending' }]),
      todoSnapshot('implement-t2', 4, at(5 * 60_000), [
        { content: 'write the failing test', status: 'completed' },
        { content: 'implement the handler', status: 'in_progress' },
      ]),
    ]
    const detail = detailOf(events)
    expect(detail.todos).toEqual([
      {
        agent: 'implement-t2',
        updatedAt: at(5 * 60_000),
        items: [
          { content: 'write the failing test', status: 'completed' },
          { content: 'implement the handler', status: 'in_progress' },
        ],
      },
      {
        agent: 'resolver-r1',
        updatedAt: at(3 * 60_000),
        items: [{ content: 'settle the gate', status: 'pending' }],
      },
    ])
  })

  it('a log with no agent_todos events yields todos: [] with the detail otherwise identical', () => {
    const withTodo = [
      ev({ altitude: 'L2', type: 'stage_enter', stage: 'implement' }, 1, at(1 * 60_000)),
      todoSnapshot('impl', 2, at(2 * 60_000), [{ content: 'step one', status: 'in_progress' }]),
      ev({ altitude: 'L0', type: 'tool_use', agent: 'impl', tool: 'write' }, 3, at(3 * 60_000)),
    ]
    const withoutTodo = [
      ev({ altitude: 'L2', type: 'stage_enter', stage: 'implement' }, 1, at(1 * 60_000)),
      ev({ altitude: 'L0', type: 'tool_use', agent: 'impl', tool: 'write' }, 3, at(3 * 60_000)),
    ]
    const withTodos = detailOf(withTodo, 'plain-run')
    const without = detailOf(withoutTodo, 'plain-run')
    expect(without.todos).toEqual([])
    expect(without).toEqual({ ...withTodos, todos: [] })
  })
})

describe('serve run-detail — the recent-events feed', () => {
  it('excludes agent_todos before the bound: a todo-dominated tail still fills the feed', () => {
    const events: SddEvent[] = []
    for (let seq = 1; seq <= 25; seq += 1) {
      events.push(ev({ altitude: 'L2', type: 'task', action: 'started', id: `t${seq}` }, seq, at(seq * 60_000)))
    }
    for (let seq = 26; seq <= 35; seq += 1) {
      events.push(todoSnapshot('impl', seq, at(seq * 60_000), [{ content: 'churn', status: 'in_progress' }]))
    }
    const detail = detailOf(events)
    expect(detail.recentEvents).toHaveLength(RECENT_EVENT_LIMIT)
    expect(detail.recentEvents.map((event) => event.seq)).toEqual(
      Array.from({ length: RECENT_EVENT_LIMIT }, (_, index) => 6 + index),
    )
  })

  it('a run mixing gate, task, and todo events feeds the gate and task events and no todo events', () => {
    const events = [
      ev({ altitude: 'L2', type: 'gate', action: 'presented', mode: 'early', version: 1 }, 1, at(1 * 60_000)),
      ev({ altitude: 'L2', type: 'task', action: 'started', id: 't1' }, 2, at(2 * 60_000)),
      todoSnapshot('impl', 3, at(3 * 60_000), [{ content: 'a', status: 'pending' }]),
      todoSnapshot('impl', 4, at(4 * 60_000), [{ content: 'a', status: 'in_progress' }]),
      todoSnapshot('impl', 5, at(5 * 60_000), [{ content: 'a', status: 'completed' }]),
    ]
    const detail = detailOf(events)
    expect(detail.recentEvents.map((event) => event.summary)).toEqual(['gate presented early v1', 'task started t1'])
  })

  it('tool_use, step_finish, and spawned keep their feed treatment', () => {
    const events = [
      ev({ altitude: 'L0', type: 'tool_use', agent: 'impl', tool: 'write' }, 1, at(1 * 60_000)),
      ev(
        {
          altitude: 'L0',
          type: 'step_finish',
          agent: 'impl',
          tokens: { input: 10, output: 5, reasoning: 0, cacheRead: 0, cacheWrite: 0 },
          costUsd: 0.01,
        },
        2,
        at(2 * 60_000),
      ),
      ev({ altitude: 'L1', type: 'spawned', agent: 'impl', role: 'implementer', model: 'glm-5.3' }, 3, at(3 * 60_000)),
      todoSnapshot('impl', 4, at(4 * 60_000), [{ content: 'step one', status: 'in_progress' }]),
    ]
    const detail = detailOf(events)
    expect(detail.recentEvents.map((event) => [event.seq, event.summary])).toEqual([
      [1, 'tool_use'],
      [2, 'step_finish'],
      [3, 'spawned'],
    ])
  })
})
