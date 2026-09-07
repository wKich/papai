// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

import { describe, expect, it } from 'bun:test'
import { readdirSync } from 'node:fs'
import path from 'node:path'

import { readEvents } from '../../../../afk-runner/src/events.js'
import { pipelineMachine } from '../../../../afk-runner/src/graph/pipeline.js'
import { foldEvents } from '../../../../afk-runner/src/kernel/fold.js'
import { createReplayFolder, replayEvents } from '../../../../afk-runner/src/legacy-fold.js'
import { owedAnswerOf } from '../../../../afk-runner/src/run-recovery.js'

const SCENARIO_ROOT = import.meta.dir

function scenarioFiles(): string[] {
  return readdirSync(SCENARIO_ROOT)
    .filter((name) => name.endsWith('.ndjson'))
    .sort()
}

const logOf = (name: string): string => path.join(SCENARIO_ROOT, name)

type FixtureEvent = ReturnType<typeof readEvents>[number]

function stageEvents(
  events: readonly FixtureEvent[],
  action: 'stage_enter' | 'stage_exit',
  stage: string,
): FixtureEvent[] {
  return events.filter((event) => event.type === action && event.stage === stage)
}

function gateVersionsOf(events: readonly FixtureEvent[], action: 'presented' | 'answered'): number[] {
  return events
    .filter((event) => event.type === 'gate' && event.action === action)
    .map((event) => (event.type === 'gate' ? event.version : 0))
}

function escalationPresentations(events: readonly FixtureEvent[]): FixtureEvent[] {
  return events.filter((event) => event.type === 'gate' && event.action === 'presented' && event.mode === 'escalation')
}

function firstAnsweredOf(events: readonly FixtureEvent[], outcome: string): FixtureEvent | undefined {
  return events.find((event) => event.type === 'gate' && event.action === 'answered' && event.outcome === outcome)
}

function roundOpensOf(events: readonly FixtureEvent[], round: number): FixtureEvent[] {
  return events.filter((event) => event.type === 'round_open' && event.round === round)
}

function hasRoundEvent(
  events: readonly FixtureEvent[],
  type: 'finding' | 'convergence' | 'round_close',
  round: number,
): boolean {
  return events.some((event) => event.type === type && event.round === round)
}

describe('scenario corpus inventory', () => {
  it('holds exactly the twenty-four recorded scenario fixtures', () => {
    expect(scenarioFiles()).toEqual([
      'abort-at-final-synthetic.ndjson',
      'armed-approval-synthetic.ndjson',
      'attempt-bound-exhaustion-synthetic.ndjson',
      'children-plan-synthetic.ndjson',
      'escalation-abort-synthetic.ndjson',
      'escalation-approve-cycle-synthetic.ndjson',
      'escalation-extend-cycle-synthetic.ndjson',
      'execution-crash-windows-synthetic.ndjson',
      'extend-at-final-cycle-synthetic.ndjson',
      'precondition-escalation-synthetic.ndjson',
      'red-verify-fix-loop-synthetic.ndjson',
      'release-approval-synthetic.ndjson',
      'release-veto-synthetic.ndjson',
      'resume-artifact-skip-gate.ndjson',
      's-depth-calm-stop-resume.ndjson',
      's-final-tail-synthetic.ndjson',
      'same-round-resume-honest-synthetic.ndjson',
      'steer-extend-round.ndjson',
      'tail-crash-resume-healed-synthetic.ndjson',
      'tail-crash-resume-synthetic.ndjson',
      'task-walk-synthetic.ndjson',
      'under-budget-retry-synthetic.ndjson',
      'veto-at-final-cycle-synthetic.ndjson',
      'veto-revision-synthetic.ndjson',
    ])
  })

  it('every scenario parses and folds under legacy-fold', () => {
    for (const name of scenarioFiles()) {
      expect(() => readEvents(logOf(name))).not.toThrow()
      expect(() => replayEvents(logOf(name))).not.toThrow()
    }
  })

  it('s-depth-calm-stop-resume covers the S profile, a mid-review boundary, and a session-continuation resume', () => {
    const state = replayEvents(logOf('s-depth-calm-stop-resume.ndjson'))
    expect(state.depth).toBe('S')
    expect(state.stages.review).toBe('active')
    expect(state.round).toEqual({ current: 1, cap: 3 })
    const events = readEvents(logOf('s-depth-calm-stop-resume.ndjson'))
    expect(events.at(-1)).toMatchObject({ type: 'resume', path: 'session-continuation', stage: 'review' })
  })

  it('resume-artifact-skip-gate covers the artifact-skip resume path the real hoard lacks', () => {
    const state = replayEvents(logOf('resume-artifact-skip-gate.ndjson'))
    expect(state.gate).toEqual({ mode: 'early', version: 1, answered: false })
    const events = readEvents(logOf('resume-artifact-skip-gate.ndjson'))
    expect(events.at(-1)).toMatchObject({ type: 'resume', path: 'artifact-skip', stage: 'gate' })
  })

  it('steer-extend-round covers extend consumption: cap hit, extend auto-decision, then a raised-cap round', () => {
    const state = replayEvents(logOf('steer-extend-round.ndjson'))
    expect(state.autoDecisions).toHaveLength(1)
    expect(state.autoDecisions[0]).toMatchObject({ rule: 'R2', decision: 'extend', gateVersion: 1 })
    expect(state.round).toEqual({ current: 2, cap: 3 })
    expect(state.lastVerdict).toMatchObject({ round: 2, verdict: 'converged' })
  })

  it('children-plan-synthetic folds the synthetic plan/children layer the runtime never produces', () => {
    const state = replayEvents(logOf('children-plan-synthetic.ndjson'))
    expect(state.children).toEqual({ gamma: { status: 'running' } })
  })

  it('veto-revision-synthetic locks the veto fold: answered outcome=veto, draft re-entry mover, no round opened', () => {
    const state = replayEvents(logOf('veto-revision-synthetic.ndjson'))
    expect(state.gate).toEqual({ mode: 'early', version: 1, answered: true })
    expect(state.stages.draft).toBe('active')
    expect(state.round).toEqual({ current: 1, cap: 1 })
    const kernel = foldEvents(pipelineMachine, readEvents(logOf('veto-revision-synthetic.ndjson'))).snapshot
    expect(kernel.value).toBe('draft')
    expect(kernel.context.gateOutcome).toBe('veto')
  })

  it('s-final-tail-synthetic covers the depth-S tail: decompose→gate entry, no atomicity bracket, exit-after-presented close', () => {
    const events = readEvents(logOf('s-final-tail-synthetic.ndjson'))
    expect(events).toHaveLength(16)
    expect(stageEvents(events, 'stage_enter', 'atomicity')).toHaveLength(0)
    expect(stageEvents(events, 'stage_exit', 'atomicity')).toHaveLength(0)
    expect(stageEvents(events, 'stage_enter', 'gate')[0]?.seq).toBe(13)
    const state = replayEvents(logOf('s-final-tail-synthetic.ndjson'))
    expect(state.depth).toBe('S')
    expect(state.stages.decompose).toBe('done')
    expect(state.stages.atomicity).toBe('pending')
    expect(state.stages.gate).toBe('active')
    expect(state.gate).toEqual({ mode: 'final', version: 1, answered: false })
  })

  it('extend-at-final-cycle-synthetic covers the full extend cycle: answered-first settle, tail re-run, v2 re-presentation, approve completes', () => {
    const events = readEvents(logOf('extend-at-final-cycle-synthetic.ndjson'))
    expect(events).toHaveLength(32)
    expect(stageEvents(events, 'stage_enter', 'decompose')).toHaveLength(2)
    expect(gateVersionsOf(events, 'presented')).toEqual([1, 2])
    expect(firstAnsweredOf(events, 'extend')?.seq).toBe(18)
    expect(stageEvents(events, 'stage_exit', 'gate')[0]?.seq).toBe(19)
    const kernel = foldEvents(pipelineMachine, events).snapshot
    expect(kernel.value).toBe('completed')
    expect(kernel.context.round).toEqual({ current: 2, cap: 4 })
  })

  it('abort-at-final-synthetic covers the abort settle: answered outcome=abort alone reaches the aborted final', () => {
    const events = readEvents(logOf('abort-at-final-synthetic.ndjson'))
    expect(events).toHaveLength(18)
    expect(events.at(-1)).toMatchObject({ type: 'gate', action: 'answered', outcome: 'abort' })
    const kernel = foldEvents(pipelineMachine, events).snapshot
    expect(kernel.value).toBe('aborted')
    expect(kernel.status).toBe('done')
  })

  it('veto-at-final-cycle-synthetic covers the veto cycle: answered→exit→draft, revision round, v2 approve completes without a phantom round_open', () => {
    const events = readEvents(logOf('veto-at-final-cycle-synthetic.ndjson'))
    expect(events).toHaveLength(35)
    expect(firstAnsweredOf(events, 'veto')?.seq).toBe(18)
    expect(stageEvents(events, 'stage_exit', 'gate')[0]?.seq).toBe(19)
    expect(stageEvents(events, 'stage_enter', 'draft').at(-1)?.seq).toBe(20)
    expect(stageEvents(events, 'stage_enter', 'decompose')).toHaveLength(2)
    const kernel = foldEvents(pipelineMachine, events).snapshot
    expect(kernel.value).toBe('completed')
    expect(kernel.context.round).toEqual({ current: 2, cap: 3 })
  })

  it('tail-crash-resume-synthetic covers the W3a crash window: gate entered, presentation never landed', () => {
    const events = readEvents(logOf('tail-crash-resume-synthetic.ndjson'))
    expect(events).toHaveLength(14)
    expect(events.at(-1)).toMatchObject({ type: 'stage_enter', stage: 'gate' })
    const state = replayEvents(logOf('tail-crash-resume-synthetic.ndjson'))
    expect(state.gate).toBeNull()
    expect(state.stages.atomicity).toBe('done')
    expect(state.stages.gate).toBe('active')
    const kernel = foldEvents(pipelineMachine, events).snapshot
    expect(kernel.value).toEqual({ gate: 'awaiting' })
  })

  it('tail-crash-resume-healed-synthetic covers the healed W3a: owed presented at the file-scan version, ladder re-run', () => {
    const events = readEvents(logOf('tail-crash-resume-healed-synthetic.ndjson'))
    expect(events).toHaveLength(16)
    expect(events.slice(14).map((event) => event.type)).toEqual(['gate', 'auto_decision'])
    const state = replayEvents(logOf('tail-crash-resume-healed-synthetic.ndjson'))
    expect(state.gate).toEqual({ mode: 'final', version: 1, answered: false })
    expect(state.stages.atomicity).toBe('done')
    expect(state.stages.gate).toBe('active')
    const kernel = foldEvents(pipelineMachine, events).snapshot
    expect(kernel.value).toEqual({ gate: 'awaiting' })
  })

  it('escalation-approve-cycle-synthetic covers the interstitial escalation cycle: failure ledger, no gate-stage entry, retry mover, completed run', () => {
    const events = readEvents(logOf('escalation-approve-cycle-synthetic.ndjson'))
    expect(events).toHaveLength(25)
    // interstitial presentation: the presented event fires from review's
    // position — no stage_enter(gate) precedes it, the gate stage never activates
    expect(stageEvents(events, 'stage_enter', 'gate')[0]?.seq).toBe(20)
    expect(escalationPresentations(events)).toHaveLength(1)
    // the approve retry mover re-enters the still-active failed stage
    expect(stageEvents(events, 'stage_enter', 'review').map((event) => event.seq)).toEqual([6, 14])
    const kernel = foldEvents(pipelineMachine, events).snapshot
    expect(kernel.value).toBe('completed')
    expect(kernel.context.failures).toEqual({})
    // the settle's exit cleared the ledger before the retry re-entered the stage
    const atMover = foldEvents(pipelineMachine, events.slice(0, 14)).snapshot
    expect(atMover.value).toBe('review')
    expect(atMover.context.stages['review']).toBe('active')
    expect(atMover.context.failures).toEqual({})
  })

  it('escalation-extend-cycle-synthetic: extend settles answered→exit→enter, the ledger clears, the run completes', () => {
    const events = readEvents(logOf('escalation-extend-cycle-synthetic.ndjson'))
    expect(events).toHaveLength(25)
    expect(gateVersionsOf(events, 'answered')).toEqual([1, 2])
    const extendAnswer = firstAnsweredOf(events, 'extend')
    expect(extendAnswer?.seq).toBe(12)
    expect(events[12]).toMatchObject({ type: 'stage_exit', stage: 'review' })
    const kernel = foldEvents(pipelineMachine, events).snapshot
    expect(kernel.value).toBe('completed')
    expect(kernel.context.failures).toEqual({})
  })

  it('escalation-abort-synthetic: the answered abort alone reaches the aborted final — the failed memo shape', () => {
    const events = readEvents(logOf('escalation-abort-synthetic.ndjson'))
    expect(events).toHaveLength(12)
    expect(events.at(-1)).toMatchObject({ type: 'gate', action: 'answered', outcome: 'abort', mode: 'escalation' })
    const kernel = foldEvents(pipelineMachine, events).snapshot
    expect(kernel.value).toBe('aborted')
    expect(kernel.status).toBe('done')
    expect(kernel.context.failures).toEqual({ review: 2 })
    expect(kernel.context.gateOutcome).toBe('abort')
  })

  it('precondition-escalation-synthetic: ONE precondition failure escalates immediately from atomicity', () => {
    const events = readEvents(logOf('precondition-escalation-synthetic.ndjson'))
    expect(events).toHaveLength(25)
    expect(events.filter((event) => event.type === 'stage_failed')).toHaveLength(1)
    const kernel = foldEvents(pipelineMachine, events).snapshot
    expect(kernel.value).toBe('completed')
    // the presented event moved atomicity's position into the compound interstitially
    const atPresented = foldEvents(pipelineMachine, events.slice(0, 15)).snapshot
    expect(atPresented.value).toEqual({ gate: 'awaiting' })
    expect(atPresented.context.stages['atomicity']).toBe('active')
  })

  it('under-budget-retry-synthetic: one failure re-runs the bracket in-place — no gate, no re-enter, completed', () => {
    const events = readEvents(logOf('under-budget-retry-synthetic.ndjson'))
    expect(events).toHaveLength(19)
    expect(events.filter((event) => event.type === 'stage_failed')).toHaveLength(1)
    expect(escalationPresentations(events)).toHaveLength(0)
    // the failed bracket stayed open: exactly one review enter, one exit —
    // the double round_open(1) is TOLERATED HISTORY (last-write-wins in both
    // folds): the log-fidelity owedness invariant stopped emitting it
    expect(stageEvents(events, 'stage_enter', 'review')).toHaveLength(1)
    expect(stageEvents(events, 'stage_exit', 'review')).toHaveLength(1)
    expect(roundOpensOf(events, 1)).toHaveLength(2)
    const kernel = foldEvents(pipelineMachine, events).snapshot
    expect(kernel.value).toBe('completed')
    expect(kernel.context.failures).toEqual({})
  })

  it('same-round-resume-honest-synthetic: the honest resume shape — one round_open, the resume event, re-run work-shaped events', () => {
    const events = readEvents(logOf('same-round-resume-honest-synthetic.ndjson'))
    expect(events).toHaveLength(21)
    // the re-entered round owes no second round_open (the owedness invariant)
    expect(roundOpensOf(events, 1)).toHaveLength(1)
    expect(events.filter((event) => event.type === 'resume')).toHaveLength(1)
    // ...but its work-shaped facts are never suppressed
    expect(hasRoundEvent(events, 'finding', 1)).toBe(true)
    expect(hasRoundEvent(events, 'convergence', 1)).toBe(true)
    expect(hasRoundEvent(events, 'round_close', 1)).toBe(true)
    const state = replayEvents(logOf('same-round-resume-honest-synthetic.ndjson'))
    expect(state.round).toEqual({ current: 1, cap: 3 })
    expect(state.lastVerdict).toMatchObject({ round: 1, verdict: 'converged' })
    const kernel = foldEvents(pipelineMachine, events).snapshot
    expect(kernel.value).toBe('completed')
    // the folds tolerate the resume event: kernel accounting counts it as
    // tolerated, and the legacy fold replays it as a strict no-op
    expect(foldEvents(pipelineMachine, events).accounting.tolerated).toBeGreaterThanOrEqual(1)
    const withoutResume = createReplayFolder()
    for (const event of events.filter((candidate) => candidate.type !== 'resume')) {
      withoutResume.fold(event)
    }
    expect(withoutResume.state).toEqual(state)
  })

  it('armed-approval-synthetic: the armed final-approve ordering — exits, mover, then the answer lands with implement active', () => {
    const events = readEvents(logOf('armed-approval-synthetic.ndjson'))
    expect(events).toHaveLength(19)
    expect(events[15]).toMatchObject({ type: 'stage_exit', stage: 'decompose' })
    expect(events[16]).toMatchObject({ type: 'stage_exit', stage: 'gate' })
    expect(events[17]).toMatchObject({ type: 'stage_enter', stage: 'implement' })
    expect(events[18]).toMatchObject({ type: 'gate', action: 'answered', outcome: 'approve', version: 1 })
    const kernel = foldEvents(pipelineMachine, events).snapshot
    expect(kernel.value).toBe('implement')
    expect(kernel.context.stages['implement']).toBe('active')
    expect(kernel.context.executionArmed).toBe(true)
    expect(kernel.context.tasks).toEqual({})
  })

  it('task-walk-synthetic: the mid-walk kill — implement active, one item done, one started-not-done', () => {
    const events = readEvents(logOf('task-walk-synthetic.ndjson'))
    expect(events).toHaveLength(22)
    expect(stageEvents(events, 'stage_enter', 'verify')).toHaveLength(0)
    const kernel = foldEvents(pipelineMachine, events).snapshot
    expect(kernel.value).toBe('implement')
    expect(kernel.context.stages['implement']).toBe('active')
    expect(kernel.context.tasks).toEqual({
      '1': { status: 'done', attempts: 1 },
      '2': { status: 'running', attempts: 1 },
    })
  })

  it('red-verify-fix-loop-synthetic: verify red routes back into implement, the fix re-walks, verify re-runs, release parks', () => {
    const events = readEvents(logOf('red-verify-fix-loop-synthetic.ndjson'))
    expect(events).toHaveLength(37)
    expect(events.filter((event) => event.type === 'stage_failed')).toEqual([])
    expect(stageEvents(events, 'stage_enter', 'verify')).toHaveLength(2)
    expect(stageEvents(events, 'stage_enter', 'implement')).toHaveLength(2)
    // the fix re-started the culprit item: attempts rose to 2, done last-wins
    const kernel = foldEvents(pipelineMachine, events).snapshot
    expect(kernel.value).toEqual({ gate: 'awaiting' })
    expect(kernel.context.gate).toEqual({ mode: 'release', version: 2, answered: false })
    expect(kernel.context.tasks).toEqual({
      '1': { status: 'done', attempts: 1 },
      '2': { status: 'done', attempts: 2 },
    })
  })

  it('attempt-bound-exhaustion-synthetic: two attempts fail, the bound halts twice, escalation presents interstitially from implement', () => {
    const events = readEvents(logOf('attempt-bound-exhaustion-synthetic.ndjson'))
    expect(events).toHaveLength(27)
    expect(events.filter((event) => event.type === 'stage_failed')).toHaveLength(2)
    // interstitial presentation: the only gate entry is the final gate's
    // (seq 13) — the escalation presentation added no stage_enter(gate)
    expect(stageEvents(events, 'stage_enter', 'gate').map((event) => event.seq)).toEqual([13])
    expect(escalationPresentations(events)).toHaveLength(1)
    // the failed bracket stays open — implement never exited
    expect(stageEvents(events, 'stage_exit', 'implement')).toHaveLength(0)
    const kernel = foldEvents(pipelineMachine, events).snapshot
    expect(kernel.value).toEqual({ gate: 'awaiting' })
    expect(kernel.context.failures).toEqual({ implement: 2 })
    expect(kernel.context.stages['implement']).toBe('active')
    expect(kernel.context.tasks).toEqual({ '1': { status: 'failed', attempts: 2 } })
  })

  it('release-approval-synthetic: exit-then-answer at the release gate completes with no implement mover', () => {
    const events = readEvents(logOf('release-approval-synthetic.ndjson'))
    expect(events).toHaveLength(31)
    expect(events[29]).toMatchObject({ type: 'stage_exit', stage: 'gate' })
    expect(events[30]).toMatchObject({ type: 'gate', action: 'answered', outcome: 'approve', mode: 'release' })
    expect(stageEvents(events, 'stage_enter', 'implement')).toHaveLength(1)
    const kernel = foldEvents(pipelineMachine, events).snapshot
    expect(kernel.value).toBe('completed')
    expect(kernel.status).toBe('done')
    expect(kernel.context.tasks).toEqual({ '1': { status: 'done', attempts: 1 } })
  })

  it('release-veto-synthetic: the veto answers first, the mover re-enters implement, the re-release approves at v3', () => {
    const events = readEvents(logOf('release-veto-synthetic.ndjson'))
    expect(events).toHaveLength(44)
    expect(events[29]).toMatchObject({ type: 'gate', action: 'answered', outcome: 'veto', version: 2 })
    expect(events[30]).toMatchObject({ type: 'stage_exit', stage: 'gate' })
    expect(events[31]).toMatchObject({ type: 'stage_enter', stage: 'implement' })
    expect(gateVersionsOf(events, 'presented')).toEqual([1, 2, 3])
    const kernel = foldEvents(pipelineMachine, events).snapshot
    expect(kernel.value).toBe('completed')
    // the re-targeted item re-started: attempts rose to 2
    expect(kernel.context.tasks).toEqual({ '1': { status: 'done', attempts: 2 } })
  })

  it('execution-crash-windows-synthetic: the reversed window — mover landed, answer missing — owes exactly the approve answer', () => {
    const events = readEvents(logOf('execution-crash-windows-synthetic.ndjson'))
    expect(events).toHaveLength(18)
    expect(events.at(-1)).toMatchObject({ type: 'stage_enter', stage: 'implement' })
    const kernel = foldEvents(pipelineMachine, events).snapshot
    expect(kernel.value).toBe('implement')
    expect(kernel.context.gate).toEqual({ mode: 'final', version: 1, answered: false })
    expect(owedAnswerOf(kernel.context, 'implement')).toEqual([
      { altitude: 'L2', type: 'gate', action: 'answered', mode: 'final', version: 1, outcome: 'approve' },
    ])
  })
})
