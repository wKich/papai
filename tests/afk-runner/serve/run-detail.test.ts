// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

import { describe, expect, it } from 'bun:test'
import path from 'node:path'

import type { EventInput, SddEvent } from '../../../afk-runner/src/events.js'
import { readEvents, stampEvent } from '../../../afk-runner/src/events.js'
import type { PersistedLite } from '../../../afk-runner/src/run-lite.js'
import { SIGNAL_EVENT_LIMIT, buildRunDetail } from '../../../afk-runner/src/serve/run-detail.js'

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

const LIVE_ROOT = path.join(import.meta.dir, '..', 'fixtures', 'live')

function lanePath(lane: string): string {
  return path.join(LIVE_ROOT, lane, 'events.ndjson')
}

/** The feed's own eligibility rule, mirrored to count rendered signal lines. */
function isSignalEvent(event: SddEvent): boolean {
  if (event.type === 'agent_todos' || event.type === 'step_finish' || event.type === 'tool_use') return false
  if (event.type === 'auto_decision' && event.decision === 'pending') return false
  return true
}

function isPendingHeartbeat(event: SddEvent): boolean {
  return event.type === 'auto_decision' && event.decision === 'pending'
}

function tokensOrZero(spend: { readonly tokens: number | null }): number {
  return spend.tokens ?? 0
}

function lastSummaryOf(detail: ReturnType<typeof buildRunDetail>): string {
  return detail.recentEvents.at(-1)?.summary ?? ''
}

function isSignalAt(bySeq: Map<number, SddEvent>, seq: number): boolean {
  const source = bySeq.get(seq)
  return source !== undefined && isSignalEvent(source)
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

describe('serve run-detail — the per-stage accounting table', () => {
  it('renders stage rows from the same delta attribution as the run totals', () => {
    const events = [
      ev({ altitude: 'L2', type: 'stage_enter', stage: 'intake' }, 1, at(1 * 60_000)),
      ev({ altitude: 'L2', type: 'stage_exit', stage: 'intake' }, 2, at(2 * 60_000)),
      ev({ altitude: 'L2', type: 'stage_enter', stage: 'draft' }, 3, at(2 * 60_000)),
      ev(
        {
          altitude: 'L0',
          type: 'step_finish',
          agent: 'drafter',
          tokens: { input: 900, output: 0, reasoning: 0, cacheRead: 0, cacheWrite: 0 },
          costUsd: 0.3,
        },
        4,
        at(3 * 60_000),
      ),
    ]
    const detail = detailOf(events)
    expect(
      detail.stageAccounts.map(({ stage, wallMs, tokens, costKnown }) => ({ stage, wallMs, tokens, costKnown })),
    ).toEqual([
      { stage: 'intake', wallMs: 60_000, tokens: 0, costKnown: true },
      { stage: 'draft', wallMs: NOW_MS - Date.parse(at(2 * 60_000)), tokens: 900, costKnown: true },
    ])
    expect(detail.stageAccounts[1]?.costUsd).toBeCloseTo(0.3, 10)
  })

  it('a degraded row (null events) renders no stage rows', () => {
    const detail = buildRunDetail({
      runId: 'degraded',
      memo: liteMemo('degraded'),
      events: null,
      now: NOW_MS,
      gateContent: null,
    })
    expect(detail.stageAccounts).toEqual([])
  })

  it('the corpus lane renders the known stage sequence in walk order', () => {
    const events = readEvents(lanePath('walk-item-green-live'), () => undefined)
    const detail = detailOf(events)
    expect(detail.stageAccounts.map((account) => account.stage)).toEqual([
      'intake',
      'draft',
      'review',
      'decompose',
      'atomicity',
      'gate',
      'implement',
      'verify',
      'release',
    ])
    expect(detail.stageAccounts.reduce((sum, account) => sum + account.tokens, 0)).toBe(tokensOrZero(detail.spend))
  })
})

describe('serve run-detail — the recent-events feed', () => {
  it('signal lines carry their distinguishing data: spawned names role + model, finding names class + detail, done names model + usage + cost', () => {
    const events = [
      ev({ altitude: 'L1', type: 'spawned', agent: 'impl', role: 'implementer', model: 'glm-5.3' }, 1, at(1 * 60_000)),
      ev(
        {
          altitude: 'L2',
          type: 'finding',
          action: 'filed',
          id: 'F1',
          round: 1,
          class: 'BLOCKER',
          detail: 'the gate parses a stale digest',
        },
        2,
        at(2 * 60_000),
      ),
      ev(
        {
          altitude: 'L1',
          type: 'done',
          agent: 'impl',
          model: 'glm-5.3',
          usage: {
            inputTokens: 118_665,
            outputTokens: 9_094,
            reasoningTokens: 17_848,
            cachedReadTokens: 0,
            cachedWriteTokens: 0,
            costUsd: 0.42,
            wallMs: 0,
          },
        },
        3,
        at(3 * 60_000),
      ),
    ]
    const detail = detailOf(events)
    expect(detail.recentEvents.map((event) => event.summary)).toEqual([
      'spawned impl · implementer · glm-5.3',
      'finding filed F1 BLOCKER — the gate parses a stale digest',
      'done impl · glm-5.3 · 145.6K tok · $0.42',
    ])
  })

  it('retrying and killed name their reason/cause and attempt; an unpriced done says so', () => {
    const events = [
      ev({ altitude: 'L1', type: 'retrying', agent: 'impl', reason: 'stall', attempt: 2 }, 1, at(1 * 60_000)),
      ev({ altitude: 'L1', type: 'killed', agent: 'impl', cause: 'timeout' }, 2, at(2 * 60_000)),
      ev(
        {
          altitude: 'L1',
          type: 'done',
          agent: 'impl',
          usage: {
            inputTokens: 4_200,
            outputTokens: 0,
            reasoningTokens: 0,
            cachedReadTokens: 0,
            cachedWriteTokens: 0,
            costUsd: 0,
            wallMs: 0,
          },
        },
        3,
        at(3 * 60_000),
      ),
    ]
    const detail = detailOf(events)
    expect(detail.recentEvents.map((event) => event.summary)).toEqual([
      'retrying impl · stall · attempt 2',
      'killed impl · timeout',
      'done impl · 4.2K tok · cost unknown',
    ])
  })

  it('a finding without class or detail still renders one line naming action + id', () => {
    const events = [ev({ altitude: 'L2', type: 'finding', action: 'resolved', id: 'F2', round: 1 }, 1, at(1 * 60_000))]
    expect(detailOf(events).recentEvents.map((event) => event.summary)).toEqual(['finding resolved F2'])
  })

  it('the corpus lane renders enriched lines: a real done names its model and usage', () => {
    const events = readEvents(lanePath('walk-item-green-live'), () => undefined)
    const firstDoneAt = events.findIndex((event) => event.type === 'done')
    expect(firstDoneAt).toBeGreaterThanOrEqual(0)
    const detail = detailOf(events.slice(0, firstDoneAt + 1))
    expect(lastSummaryOf(detail)).toMatch(/^done .+ · .+ · [\d.]+[KM]? tok · /u)
  })

  it('excludes step_finish and pending auto_decision heartbeats before the bound; other auto_decisions stay', () => {
    const events = [
      ev({ altitude: 'L2', type: 'stage_enter', stage: 'review' }, 1, at(1 * 60_000)),
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
      ev(
        {
          altitude: 'L2',
          type: 'auto_decision',
          rule: 'none',
          decision: 'pending',
          evidenceDigest: '',
          gateVersion: 1,
        },
        3,
        at(3 * 60_000),
      ),
      ev(
        { altitude: 'L2', type: 'auto_decision', rule: 'R1', decision: 'approve', evidenceDigest: '', gateVersion: 1 },
        4,
        at(4 * 60_000),
      ),
    ]
    const detail = detailOf(events)
    expect(detail.recentEvents.map((event) => [event.seq, event.summary])).toEqual([
      [1, 'stage_enter review'],
      [4, 'auto_decision'],
    ])
  })

  it('a heartbeat flood cannot shrink the feed: the 6,339-heartbeat lane leaves signal lines in the window', () => {
    const events = readEvents(lanePath('runner-cli-config-live'), () => undefined)
    const pending = events.filter(isPendingHeartbeat).length
    expect(pending).toBe(6_339)
    const detail = detailOf(events)
    expect(detail.recentEvents).toHaveLength(SIGNAL_EVENT_LIMIT)
    const bySeq = new Map(events.map((event) => [event.seq, event]))
    for (const rendered of detail.recentEvents) {
      expect(isSignalAt(bySeq, rendered.seq)).toBe(true)
    }
  })

  it('the bound applies to rendered feed content: the fat window holds 250 signal lines whole', () => {
    const events = readEvents(lanePath('runner-cli-config-live'), () => undefined)
    const signal = events.filter(isSignalEvent)
    expect(signal.length).toBeGreaterThan(SIGNAL_EVENT_LIMIT)
    const detail = detailOf(events)
    expect(detail.recentEvents).toHaveLength(SIGNAL_EVENT_LIMIT)
    const lastSignal = signal[signal.length - 1]
    expect(detail.recentEvents.at(-1)?.seq).toBe(lastSignal?.seq)
  })

  it('excludes agent_todos before the bound: a todo-dominated tail still fills the feed', () => {
    const events: SddEvent[] = []
    for (let seq = 1; seq <= 25; seq += 1) {
      events.push(ev({ altitude: 'L2', type: 'task', action: 'started', id: `t${seq}` }, seq, at(seq * 60_000)))
    }
    for (let seq = 26; seq <= 35; seq += 1) {
      events.push(todoSnapshot('impl', seq, at(seq * 60_000), [{ content: 'churn', status: 'in_progress' }]))
    }
    const detail = detailOf(events)
    // the fat window holds every signal line whole; no todo seq renders
    expect(detail.recentEvents).toHaveLength(25)
    expect(detail.recentEvents.map((event) => event.seq)).toEqual(Array.from({ length: 25 }, (_, index) => 1 + index))
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

  it('tool_use never feeds: activity renders through the strips field instead', () => {
    const events = [
      ev({ altitude: 'L0', type: 'tool_use', agent: 'impl', tool: 'write', arg: 'src/foo.ts' }, 1, at(1 * 60_000)),
      ev({ altitude: 'L1', type: 'spawned', agent: 'impl', role: 'implementer', model: 'glm-5.3' }, 2, at(2 * 60_000)),
      ev({ altitude: 'L0', type: 'tool_use', agent: 'impl', tool: 'edit', arg: 'src/foo.ts' }, 3, at(3 * 60_000)),
      todoSnapshot('impl', 4, at(4 * 60_000), [{ content: 'step one', status: 'in_progress' }]),
    ]
    const detail = detailOf(events)
    expect(detail.recentEvents.map((event) => [event.seq, event.summary])).toEqual([
      [2, 'spawned impl · implementer · glm-5.3'],
    ])
    expect(detail.strips).toEqual([
      {
        agent: 'impl',
        role: 'implementer',
        model: 'glm-5.3',
        tokens: 0,
        costUsd: 0,
        lastTool: { tool: 'edit', arg: 'src/foo.ts' },
        transcript: 'impl-r0-a1.jsonl',
      },
    ])
  })
})
