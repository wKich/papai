// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

/**
 * The gate front-matter copy (title, response grammar, decisions block):
 * every decision line names its downstream effect, so no approval is
 * consequence-blind. Split from gate-render.ts at the max-lines seam.
 */

export interface DecisionConsequences {
  readonly approve: string
  readonly veto: string
  readonly extend: string | null
  readonly abort: string
}

export function gateTitle(mode: 'early' | 'final' | 'release', changeName: string): string {
  if (mode === 'early') return `## Early gate (cap hit) — change ${changeName}`
  if (mode === 'release') return `## Release gate — change ${changeName}`
  return `## Final gate — change ${changeName}`
}

/** The response grammar lines a mode teaches the operator (U3 D7: release offers no extend). */
export function grammarLines(mode: 'early' | 'final' | 'release'): string[] {
  if (mode === 'release') {
    return [
      'Write `APPROVE` on its own line to complete the run, `VETO: <redirect>` to send the redirects back into implement, or `ABORT` to abort.',
      'A response with no decision signal is rejected — prose alone settles nothing.',
    ]
  }
  return [
    'Check every assumption box to approve. Leave a box unchecked to veto (optional `→ <redirect>` beneath).',
    'Answer a cap-hit blocker with `→ <answer>` beneath it, or `→ OVERRIDE` to override.',
    'Write `APPROVE` on its own line to approve the change as a whole, or `VETO: <redirect>` to veto it as a whole.',
    'A response with no decision signal is rejected — prose alone settles nothing.',
    'Write `ABORT` on its own line to abort.',
  ]
}

/**
 * Single source for each gate decision's downstream effect, consumed by both
 * the gate-file `### Decisions` block and the interactive session's decision
 * menu — the two front-ends cannot drift apart (Decision 6).
 */
export function decisionConsequences(mode: 'early' | 'final' | 'release'): DecisionConsequences {
  if (mode === 'release') {
    return {
      approve: 'completes the run',
      veto: 're-enters implement applying the redirects',
      extend: null,
      abort: 'aborts the run',
    }
  }
  const approve =
    mode === 'early'
      ? 'continues to task decomposition, atomicity checking, and a final gate'
      : 'completes the run with the full artifact set'
  return {
    approve,
    veto: 'runs one resolver pass on the redirects, then re-gates',
    extend: mode === 'early' ? 'runs one more review round, then re-gates' : null,
    abort: 'ends the run without completing',
  }
}

/**
 * Render the `### Decisions` block: at an early (cap-hit) gate approval
 * continues the pipeline into decomposition, atomicity checking, and a final
 * gate; at the final gate approval completes the run; at a release gate
 * (U3 D7) the decisions are verb-only — no boxes, no extend.
 */
export function renderDecisions(mode: 'early' | 'final' | 'release'): string[] {
  const c = decisionConsequences(mode)
  if (mode === 'release') {
    return [
      '### Decisions',
      '',
      '- **approve** (`APPROVE`) — completes the run',
      '- **veto** (`VETO: <redirect>`) — re-enters implement applying the redirects',
      '- **abort** (`ABORT`) — aborts the run; the only early exit that spends nothing further',
    ]
  }
  return [
    '### Decisions',
    '',
    `- **approve** (\`APPROVE\`, or every box checked) — ${c.approve}`,
    '- **veto** (leave a box unchecked, or `VETO: <redirect>` for the whole change) — runs one resolver pass on the redirects, then re-gates',
    ...(c.extend === null ? [] : [`- **extend** (\`→ RUN 1 MORE\`) — ${c.extend} (early-gate only)`]),
    '- **abort** (`ABORT` on its own line) — ends the run without completing; the only early exit that spends nothing further',
  ]
}
