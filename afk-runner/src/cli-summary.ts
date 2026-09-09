// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

import { existsSync } from 'node:fs'
import path from 'node:path'

import { pipelineMachine } from './graph/pipeline.js'
import { foldLog } from './kernel/fold.js'
import type { RunStatus } from './run.js'

/**
 * The CLI's read-only fold-summary surface, split from `cli.ts` when the
 * verb-time MCP wiring (afk-runner-agent-mcp D1) pushed that file past
 * `max-lines`: the bare run-dir fold and the status verb's full-state
 * rendering change for different reasons than verb dispatch does. Neither
 * half resolves the config ladder or the MCP surface — the bare fold is not
 * a spawning verb, and status reads folded state only.
 */

export function runCli(argv: readonly string[]): string {
  const runDir = argv[0]
  if (runDir === undefined || runDir.length === 0) {
    throw new Error('usage: afk-runner <runDir>')
  }
  const logPath = path.join(runDir, 'events.ndjson')
  if (!existsSync(logPath)) {
    throw new Error(
      `events.ndjson not found: ${logPath} — pass 'start <taskFile>' to drive a run, 'resume <runId>' to attend a parked one, or 'status'/'report' to inspect`,
    )
  }
  const { snapshot, accounting } = foldLog(pipelineMachine, logPath)
  const value = typeof snapshot.value === 'string' ? snapshot.value : JSON.stringify(snapshot.value)
  const lines: string[] = [
    `value: ${value}`,
    ...Object.entries(snapshot.context.stages).map(([stage, status]) => `${stage}: ${status}`),
    `events: ${accounting.total} (mapped ${accounting.mapped}, tolerated ${accounting.tolerated})`,
  ]
  const summary = lines.join('\n')
  console.log(summary)
  return summary
}

/** The folded full-state summary the status command prints. */
export function fullStateSummary(status: RunStatus): string {
  const context = status.context
  const lines: string[] = [
    `value: ${status.position}`,
    ...Object.entries(context.stages).map(([stage, stageStatus]) => `${stage}: ${stageStatus}`),
    `depth: ${context.depth ?? 'unclassified'}`,
    `round: ${context.round === null ? 'none' : `${context.round.current}/${context.round.cap}`}`,
    `rounds recorded: ${context.perRound.length}`,
    `last verdict: ${context.lastVerdict === null ? 'none' : `${context.lastVerdict.verdict} (${context.lastVerdict.counts.blocker}b ${context.lastVerdict.counts.material}m ${context.lastVerdict.counts.nitpick}n)`}`,
    `gate: ${context.gate === null ? 'none' : `${context.gate.mode} v${context.gate.version}${context.gate.answered ? ' answered' : ' awaiting'}`}`,
    `halted: ${status.parked}`,
  ]
  return lines.join('\n')
}
