// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

import { describe, expect, it } from 'bun:test'

import {
  AgentDoneEvent,
  AgentTodosEvent,
  KilledEvent,
  RetryingEvent,
  SpawnedEvent,
  StepFinishEvent,
  ToolUseEvent,
} from '../../afk-runner/src/agent-noise-schemas.js'

describe('the L0/L1 noise-schema lane accepts its canonical shapes', () => {
  it('L0 telemetry', () => {
    expect(ToolUseEvent.safeParse({ altitude: 'L0', type: 'tool_use', agent: 'a', tool: 't' }).success).toBe(true)
    expect(
      StepFinishEvent.safeParse({
        altitude: 'L0',
        type: 'step_finish',
        agent: 'a',
        tokens: { input: 1, output: 2, reasoning: 0 },
        costUsd: 0.1,
      }).success,
    ).toBe(true)
  })

  it('L1 lifecycle', () => {
    expect(SpawnedEvent.safeParse({ altitude: 'L1', type: 'spawned', agent: 'a', role: 'r', model: 'm' }).success).toBe(
      true,
    )
    expect(
      RetryingEvent.safeParse({ altitude: 'L1', type: 'retrying', agent: 'a', reason: 'stall', attempt: 2 }).success,
    ).toBe(true)
    expect(KilledEvent.safeParse({ altitude: 'L1', type: 'killed', agent: 'a', cause: 'timeout' }).success).toBe(true)
    expect(
      AgentDoneEvent.safeParse({
        altitude: 'L1',
        type: 'done',
        agent: 'a',
        usage: { inputTokens: 1, outputTokens: 1, reasoningTokens: 0, costUsd: 0.1, wallMs: 5 },
      }).success,
    ).toBe(true)
  })
})

describe('SpawnedEvent mcp names (afk-runner-agent-mcp D6)', () => {
  it('accepts the resolved set names and keeps them in the parsed output', () => {
    const parsed = SpawnedEvent.parse({
      altitude: 'L1',
      type: 'spawned',
      agent: 'reviewer-r1',
      role: 'reviewer',
      model: 'default-model',
      mcp: ['search'],
    })
    expect(parsed.mcp).toEqual(['search'])
  })

  it('parses an old-log spawned event with no mcp field unchanged', () => {
    const parsed = SpawnedEvent.parse({ altitude: 'L1', type: 'spawned', agent: 'a', role: 'r', model: 'm' })
    expect(Object.hasOwn(parsed, 'mcp')).toBe(false)
  })

  it('rejects a non-array mcp value and an empty server name', () => {
    expect(
      SpawnedEvent.safeParse({ altitude: 'L1', type: 'spawned', agent: 'a', role: 'r', model: 'm', mcp: 'search' })
        .success,
    ).toBe(false)
    expect(
      SpawnedEvent.safeParse({ altitude: 'L1', type: 'spawned', agent: 'a', role: 'r', model: 'm', mcp: [''] }).success,
    ).toBe(false)
  })
})

describe('AgentTodosEvent (agent-todos-capture D3)', () => {
  const todos = [{ content: 'RED: add llm:verifier rows', status: 'in_progress' }]

  it('accepts a stamped L0 {agent, todos} event', () => {
    expect(
      AgentTodosEvent.safeParse({ altitude: 'L0', type: 'agent_todos', agent: 'implement-t2', todos }).success,
    ).toBe(true)
    expect(AgentTodosEvent.safeParse({ altitude: 'L0', type: 'agent_todos', agent: 'a', todos: [] }).success).toBe(true)
  })

  it('rejects malformed items, a missing agent, and wrong altitudes', () => {
    expect(
      AgentTodosEvent.safeParse({
        altitude: 'L0',
        type: 'agent_todos',
        agent: 'a',
        todos: [{ content: 1, status: 'x' }],
      }).success,
    ).toBe(false)
    expect(
      AgentTodosEvent.safeParse({ altitude: 'L0', type: 'agent_todos', agent: 'a', todos: 'all done' }).success,
    ).toBe(false)
    expect(AgentTodosEvent.safeParse({ altitude: 'L0', type: 'agent_todos', todos }).success).toBe(false)
    expect(AgentTodosEvent.safeParse({ altitude: 'L2', type: 'agent_todos', agent: 'a', todos }).success).toBe(false)
  })
})
