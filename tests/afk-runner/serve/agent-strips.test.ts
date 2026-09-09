// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

import { describe, expect, it } from 'bun:test'
import path from 'node:path'

import type { EventInput, SddEvent } from '../../../afk-runner/src/events.js'
import { readEvents, stampEvent } from '../../../afk-runner/src/events.js'
import { agentStripsOf } from '../../../afk-runner/src/serve/agent-strips.js'

/**
 * The per-agent strip projection (tool-reports D2): L0 activity (tool use,
 * step-finish deltas) collapses into one strip per in-flight agent — label,
 * model, live delta ticker, last tool call, transcript pointer — and the
 * strip collapses into the agent's enriched `done` line at completion.
 */

const LIVE_ROOT = path.join(import.meta.dir, '..', 'fixtures', 'live')

function at(offsetMs: number): string {
  return new Date(Date.parse('2026-09-01T00:00:00.000Z') + offsetMs).toISOString()
}

function ev(init: EventInput, seq: number, ts: string): SddEvent {
  return stampEvent(init, seq, ts)
}

function spawned(agent: string, seq: number, role = 'implementer', model = 'glm-5.3'): SddEvent {
  return ev({ altitude: 'L1', type: 'spawned', agent, role, model }, seq, at(seq * 60_000))
}

function toolUse(agent: string, seq: number, tool: string, arg?: string): SddEvent {
  return arg === undefined
    ? ev({ altitude: 'L0', type: 'tool_use', agent, tool }, seq, at(seq * 60_000))
    : ev({ altitude: 'L0', type: 'tool_use', agent, tool, arg }, seq, at(seq * 60_000))
}

function stepFinish(agent: string, seq: number, tokens: number, costUsd: number): SddEvent {
  return ev(
    {
      altitude: 'L0',
      type: 'step_finish',
      agent,
      tokens: { input: tokens, output: 0, reasoning: 0, cacheRead: 0, cacheWrite: 0 },
      costUsd,
    },
    seq,
    at(seq * 60_000),
  )
}

describe('serve agent-strips — the per-agent strip projection', () => {
  it('an in-flight agent renders label, model, live delta ticker, last tool + argument, transcript path', () => {
    const strips = agentStripsOf([
      ev({ altitude: 'L2', type: 'round_open', round: 1, cap: 3 }, 1, at(1 * 60_000)),
      spawned('implement-t2', 2),
      toolUse('implement-t2', 3, 'read', 'src/foo.ts'),
      toolUse('implement-t2', 4, 'edit', 'src/foo.ts'),
      stepFinish('implement-t2', 5, 900, 0.2),
      stepFinish('implement-t2', 6, 300, 0.1),
    ])
    const [strip] = strips
    expect(strip).toMatchObject({
      agent: 'implement-t2',
      role: 'implementer',
      model: 'glm-5.3',
      tokens: 1_200,
      lastTool: { tool: 'edit', arg: 'src/foo.ts' },
      transcript: 'implement-t2-r1-a1.jsonl',
    })
    expect(strip?.costUsd).toBeCloseTo(0.3, 10)
  })

  it('the strip collapses at done and re-opens at the next spawn with the next attempt and a fresh ticker', () => {
    const events = [
      spawned('implement-t2', 1),
      stepFinish('implement-t2', 2, 500, 0.1),
      ev(
        {
          altitude: 'L1',
          type: 'done',
          agent: 'implement-t2',
          usage: {
            inputTokens: 500,
            outputTokens: 0,
            reasoningTokens: 0,
            cachedReadTokens: 0,
            cachedWriteTokens: 0,
            costUsd: 0.1,
            wallMs: 0,
          },
        },
        3,
        at(3 * 60_000),
      ),
    ]
    expect(agentStripsOf(events)).toEqual([])
    const reopened = agentStripsOf([
      ...events,
      spawned('implement-t2', 4),
      toolUse('implement-t2', 5, 'bash', 'bun test'),
    ])
    expect(reopened).toHaveLength(1)
    expect(reopened[0]?.tokens).toBe(0)
    expect(reopened[0]?.transcript).toBe('implement-t2-r0-a2.jsonl')
    expect(reopened[0]?.lastTool).toEqual({ tool: 'bash', arg: 'bun test' })
  })

  it('killed collapses the strip; a tool_use without argument renders a bare tool', () => {
    const killed = agentStripsOf([
      spawned('skeptic-r1', 1),
      toolUse('skeptic-r1', 2, 'grep'),
      ev({ altitude: 'L1', type: 'killed', agent: 'skeptic-r1', cause: 'timeout' }, 3, at(3 * 60_000)),
    ])
    expect(killed).toEqual([])
    const bare = agentStripsOf([spawned('skeptic-r1', 1), toolUse('skeptic-r1', 2, 'grep')])
    expect(bare[0]?.lastTool).toEqual({ tool: 'grep', arg: null })
  })

  it('two in-flight agents render as two strips in spawn order with independent tickers', () => {
    const strips = agentStripsOf([
      spawned('reviewer-r2', 1, 'reviewer'),
      spawned('skeptic-r2', 2, 'skeptic'),
      stepFinish('skeptic-r2', 3, 100, 0.02),
      stepFinish('reviewer-r2', 4, 400, 0.04),
    ])
    expect(strips.map((strip) => [strip.agent, strip.tokens, strip.role])).toEqual([
      ['reviewer-r2', 400, 'reviewer'],
      ['skeptic-r2', 100, 'skeptic'],
    ])
  })

  it('a corpus prefix pins the live shape: implement-t4 in flight mid-walk, round 3, attempt 1', () => {
    const events = readEvents(path.join(LIVE_ROOT, 'walk-item-green-live', 'events.ndjson'), () => undefined)
    const prefix = events.filter((event) => event.seq <= 1_500)
    const strips = agentStripsOf(prefix)
    const t4 = strips.find((strip) => strip.agent === 'implement-t4')
    expect(t4).toMatchObject({
      agent: 'implement-t4',
      role: 'implementer',
      model: 'zai-coding-plan/glm-5.3',
      transcript: 'implement-t4-r3-a1.jsonl',
    })
    expect(t4?.tokens).toBeGreaterThan(0)
    expect(t4?.lastTool).not.toBeNull()
  })
})
