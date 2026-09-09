// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

import type { SddEvent } from '../events.js'
import { tokensOf } from '../work/gate-signals.js'

/**
 * The board-local delta spend fold (tool-reports D1): spend = Σ all
 * `step_finish` deltas + Σ per-completion `max(0, done.usage − Σ that
 * agent's deltas since its previous completion)`. On every corpus lane the
 * union equals Σdeltas exactly (clean sessions: done ≡ Σdeltas; killed
 * sessions: deltas ≥ done, the clamp yields 0) — the residual exists for the
 * backend that emits a completion aggregate without per-step deltas, counted
 * then exactly once. `usageTotalsOf` (the R4 ladder's fail-closed input) is
 * deliberately untouched: this is a reporting fold, not an accounting change.
 */

export interface DeltaSpend {
  readonly tokens: number
  readonly costUsd: number
  readonly costKnown: boolean
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

export function deltaSpendOf(events: readonly SddEvent[]): DeltaSpend {
  let tokens = 0
  let costUsd = 0
  let costKnown = true
  const sinceCompletion = new Map<string, { tokens: number; costUsd: number }>()
  for (const event of events) {
    if (event.type === 'step_finish') {
      const stepTokens = stepTokensOf(event.tokens)
      tokens += stepTokens
      costUsd += event.costUsd
      if (stepTokens > 0 && event.costUsd === 0) costKnown = false
      const acc = sinceCompletion.get(event.agent) ?? { tokens: 0, costUsd: 0 }
      sinceCompletion.set(event.agent, { tokens: acc.tokens + stepTokens, costUsd: acc.costUsd + event.costUsd })
    } else if (event.type === 'done') {
      const acc = sinceCompletion.get(event.agent) ?? { tokens: 0, costUsd: 0 }
      const residualTokens = Math.max(0, tokensOf(event.usage) - acc.tokens)
      tokens += residualTokens
      costUsd += Math.max(0, event.usage.costUsd - acc.costUsd)
      // the per-done rule, one altitude finer: only an aggregate that actually
      // contributes residual tokens can mark the cost unknown
      if (residualTokens > 0 && event.usage.costUsd === 0) costKnown = false
      sinceCompletion.set(event.agent, { tokens: 0, costUsd: 0 })
    }
  }
  return { tokens, costUsd, costKnown }
}
