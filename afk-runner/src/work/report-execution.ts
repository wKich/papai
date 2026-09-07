// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

import type { SddEvent } from '../events.js'
import type { VerifyOutcomeLine } from './gate-model.js'

interface ExecutionFacts {
  readonly tasksDone: number
  readonly tasksTotal: number
  readonly releaseVersion: number | null
  readonly releaseOutcome: string | null
}

/** The execution facts (U3 D9): task records last-wins, the release gate's latest version and outcome. */
function executionFactsFrom(events: readonly SddEvent[]): ExecutionFacts | null {
  let armed = false
  const taskStatus = new Map<string, string>()
  let releaseVersion: number | null = null
  let releaseOutcome: string | null = null
  for (const event of events) {
    if (event.type === 'execution') armed = true
    else if (event.type === 'task') {
      taskStatus.set(event.id, event.action === 'started' ? 'running' : event.action)
    } else if (event.type === 'gate' && event.mode === 'release' && event.action !== 'rearmed') {
      releaseVersion = event.version
      if (event.action === 'answered' && event.outcome !== undefined) releaseOutcome = event.outcome
    }
  }
  if (!armed) return null
  let tasksDone = 0
  for (const status of taskStatus.values()) {
    if (status === 'done') tasksDone += 1
  }
  return { tasksDone, tasksTotal: taskStatus.size, releaseVersion, releaseOutcome }
}

/**
 * The report's execution facts block (U3 D9): task progress, the verify
 * logs' verdicts, and the release gate's version with its outcome — empty
 * (block omitted) on unarmed runs and armed runs with nothing walked yet.
 */
export function executionBlockLines(events: readonly SddEvent[], outcomes: readonly VerifyOutcomeLine[]): string[] {
  const facts = executionFactsFrom(events)
  if (facts === null) return []
  const lines: string[] = []
  if (facts.tasksTotal > 0) lines.push(`tasks: ${facts.tasksDone}/${facts.tasksTotal} done`)
  if (outcomes.length > 0) {
    lines.push(`verify: ${outcomes.map((outcome) => `${outcome.log} ${outcome.verdict}`).join(', ')}`)
  }
  if (facts.releaseVersion !== null) {
    lines.push(`release: v${facts.releaseVersion} ${facts.releaseOutcome ?? 'pending'}`)
  }
  return lines
}
