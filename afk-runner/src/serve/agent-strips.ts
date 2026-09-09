// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

import type { SddEvent } from '../events.js'

/**
 * The per-agent strip projection (tool-reports D2): L0 activity never feeds —
 * tool use and step-finish deltas collapse into one strip per in-flight agent
 * (spawned, no terminal event since). The transcript pointer follows the
 * session ledger's `<label>-r<round>-a<attempt>.jsonl` naming: round is the
 * latest `round_open` at spawn, attempt is the spawn ordinal within that
 * round. A strip collapses into its agent's enriched `done` line at
 * completion — terminal events (`done`/`killed`) close it, a later `spawned`
 * re-opens it at the next attempt.
 */

export interface AgentStripTool {
  readonly tool: string
  readonly arg: string | null
}

export interface AgentStrip {
  readonly agent: string
  readonly role: string
  readonly model: string
  readonly tokens: number
  readonly costUsd: number
  readonly lastTool: AgentStripTool | null
  readonly transcript: string
}

interface StripState {
  readonly agent: string
  role: string
  model: string
  tokens: number
  costUsd: number
  lastTool: AgentStripTool | null
  transcript: string
  inFlight: boolean
}

function stepTokensOf(tokens: {
  input: number
  output: number
  reasoning: number
  cacheRead: number
  cacheWrite: number
}): number {
  return tokens.input + tokens.output + tokens.reasoning + tokens.cacheRead + tokens.cacheWrite
}

/** Open (or re-open at the next attempt) one agent's strip from its `spawned` event. */
function openStrip(
  strips: Map<string, StripState>,
  order: string[],
  spawnCount: Map<string, number>,
  event: Extract<SddEvent, { type: 'spawned' }>,
  round: number,
): void {
  const key = `${event.agent}@r${round}`
  const attempt = (spawnCount.get(key) ?? 0) + 1
  spawnCount.set(key, attempt)
  if (!strips.has(event.agent)) order.push(event.agent)
  strips.set(event.agent, {
    agent: event.agent,
    role: event.role,
    model: event.model,
    tokens: 0,
    costUsd: 0,
    lastTool: null,
    transcript: `${event.agent}-r${round}-a${attempt}.jsonl`,
    inFlight: true,
  })
}

export function agentStripsOf(events: readonly SddEvent[]): readonly AgentStrip[] {
  const strips = new Map<string, StripState>()
  const order: string[] = []
  const spawnCount = new Map<string, number>()
  let round = 0
  for (const event of events) {
    if (event.type === 'round_open') round = event.round
    else if (event.type === 'spawned') openStrip(strips, order, spawnCount, event, round)
    else if (event.type === 'done' || event.type === 'killed') {
      const state = strips.get(event.agent)
      if (state !== undefined) state.inFlight = false
    } else if (event.type === 'tool_use') {
      const state = strips.get(event.agent)
      if (state !== undefined) state.lastTool = { tool: event.tool, arg: event.arg ?? null }
    } else if (event.type === 'step_finish') {
      const state = strips.get(event.agent)
      if (state !== undefined) {
        state.tokens += stepTokensOf(event.tokens)
        state.costUsd += event.costUsd
      }
    }
  }
  return order
    .map((agent) => strips.get(agent))
    .filter((state): state is StripState => state !== undefined && state.inFlight)
    .map(({ agent, role, model, tokens, costUsd, lastTool, transcript }) => ({
      agent,
      role,
      model,
      tokens,
      costUsd,
      lastTool,
      transcript,
    }))
}
