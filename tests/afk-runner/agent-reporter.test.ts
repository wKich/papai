// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

import { describe, expect, it } from 'bun:test'
import assert from 'node:assert'

import { createAgentReporter } from '../../afk-runner/src/agent-reporter.js'
import type { EventInput } from '../../afk-runner/src/events.js'

function harness(): { emitted: EventInput[]; reporter: ReturnType<typeof createAgentReporter> } {
  const emitted: EventInput[] = []
  const reporter = createAgentReporter('resolver-r1', (event) => {
    emitted.push(event)
  })
  return { emitted, reporter }
}

describe('createAgentReporter', () => {
  it('parses a slot line into a tool_use event tagged with the construction label', () => {
    const { emitted, reporter } = harness()
    reporter.slot?.('resolver-r1', 'resolver-r1 \u25B6 readFile foo.ts \u00B7 4s \u00B7 3 tools')
    expect(emitted).toHaveLength(1)
    expect(emitted[0]).toMatchObject({
      altitude: 'L0',
      type: 'tool_use',
      agent: 'resolver-r1',
      tool: 'readFile',
      arg: 'foo.ts',
    })
  })

  it('emits nothing when slot is cleared (line === null)', () => {
    const { emitted, reporter } = harness()
    reporter.slot?.('resolver-r1', null)
    expect(emitted).toHaveLength(0)
  })

  it('falls back to (unknown) tool with the full line as arg for an unrecognized shape', () => {
    const { emitted, reporter } = harness()
    reporter.slot?.('resolver-r1', 'something weird happened here')
    expect(emitted).toHaveLength(1)
    expect(emitted[0]).toMatchObject({
      altitude: 'L0',
      type: 'tool_use',
      agent: 'resolver-r1',
      tool: '(unknown)',
    })
  })

  it('translates usage() into a step_finish event with token + cost delta', () => {
    const { emitted, reporter } = harness()
    reporter.usage?.({ input: 1200, output: 800, reasoning: 30, cost: 0.0142 })
    expect(emitted).toHaveLength(1)
    expect(emitted[0]).toMatchObject({
      altitude: 'L0',
      type: 'step_finish',
      agent: 'resolver-r1',
      tokens: { input: 1200, output: 800, reasoning: 30 },
      costUsd: 0.0142,
    })
  })

  it('carries cached token deltas into the step_finish event', () => {
    const { emitted, reporter } = harness()
    reporter.usage?.({ input: 1757, output: 3, reasoning: 0, cacheRead: 8320, cacheWrite: 4096, cost: 0 })
    expect(emitted).toHaveLength(1)
    expect(emitted[0]).toMatchObject({
      type: 'step_finish',
      tokens: { input: 1757, output: 3, reasoning: 0, cacheRead: 8320, cacheWrite: 4096 },
    })
  })

  it('reports dynamic === false so withLivePhase skips its ticking path', () => {
    const { reporter } = harness()
    expect(reporter.dynamic).toBe(false)
  })

  it('treats event/log/live/clearLive as no-ops (do not emit)', () => {
    const { emitted, reporter } = harness()
    reporter.event('a scrolling line')
    reporter.log('a log line')
    reporter.live(['a live line'])
    reporter.clearLive()
    expect(emitted).toHaveLength(0)
  })

  it('treats optional diff/issue/statusSuffix hooks as no-ops when present', () => {
    const { emitted, reporter } = harness()
    reporter.diff?.('reviewer-r1', { added: 1, removed: 0 })
    reporter.issue?.({ type: 'round', round: 1, maxRounds: 3 })
    reporter.statusSuffix?.()
    expect(emitted).toHaveLength(0)
  })
})

describe('createAgentReporter todo capture (agent-todos-capture D3/D4)', () => {
  it('maps the todos hook to an L0 agent_todos emission tagged with the label', () => {
    const { emitted, reporter } = harness()
    reporter.todos?.([
      { content: 'RED: add llm:verifier rows', status: 'in_progress' },
      { content: 'GREEN: implementation', status: 'pending' },
    ])
    expect(emitted).toHaveLength(1)
    expect(emitted[0]).toMatchObject({
      altitude: 'L0',
      type: 'agent_todos',
      agent: 'resolver-r1',
      todos: [
        { content: 'RED: add llm:verifier rows', status: 'in_progress' },
        { content: 'GREEN: implementation', status: 'pending' },
      ],
    })
  })

  it('an identical consecutive snapshot emits once, a changed one emits again', () => {
    const { emitted, reporter } = harness()
    const todos = [{ content: 'RED: add llm:verifier rows', status: 'in_progress' }]
    reporter.todos?.(todos)
    reporter.todos?.(todos)
    expect(emitted).toHaveLength(1)
    reporter.todos?.([{ content: 'RED: add llm:verifier rows', status: 'completed' }])
    expect(emitted).toHaveLength(2)
    expect(emitted[1]).toMatchObject({ todos: [{ status: 'completed' }] })
  })

  it('truncates content at 200 characters', () => {
    const { emitted, reporter } = harness()
    reporter.todos?.([{ content: 'x'.repeat(250), status: 'pending' }])
    const event = emitted.find((e): e is Extract<EventInput, { type: 'agent_todos' }> => e.type === 'agent_todos')
    assert(event !== undefined)
    expect(event.todos[0]?.content).toHaveLength(200)
  })

  it('caps a list at 20 items', () => {
    const { emitted, reporter } = harness()
    const todos = Array.from({ length: 25 }, (_, i) => ({ content: `item ${i}`, status: 'pending' }))
    reporter.todos?.(todos)
    const event = emitted.find((e): e is Extract<EventInput, { type: 'agent_todos' }> => e.type === 'agent_todos')
    assert(event !== undefined)
    expect(event.todos).toHaveLength(20)
    expect(event.todos[19]?.content).toBe('item 19')
  })
})

describe('createAgentReporter sawTodos flag (afk-runner-task-todos D4)', () => {
  it('is false until the todos hook fires and true after any firing, deduped or not', () => {
    const { reporter } = harness()
    expect(reporter.sawTodos()).toBe(false)
    reporter.slot?.('resolver-r1', 'resolver-r1 ▶ read foo.ts · 4s · 3 tools')
    reporter.usage?.({ input: 1, output: 1, reasoning: 0, cost: 0 })
    expect(reporter.sawTodos()).toBe(false)
    const todos = [{ content: 'RED: add rows', status: 'in_progress' }]
    reporter.todos?.(todos)
    expect(reporter.sawTodos()).toBe(true)
    // an identical (deduped, non-emitting) snapshot still counts as a firing
    reporter.todos?.(todos)
    expect(reporter.sawTodos()).toBe(true)
  })
})
