// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

import { afterEach, describe, expect, it } from 'bun:test'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'

import type { EventInput, SddEvent } from '../../../afk-runner/src/events.js'
import { readEvents, stampEvent } from '../../../afk-runner/src/events.js'
import { pipelineMachine } from '../../../afk-runner/src/graph/pipeline.js'
import { foldEvents } from '../../../afk-runner/src/kernel/fold.js'
import { resumeRun } from '../../../afk-runner/src/run-resume.js'
import { startRun } from '../../../afk-runner/src/run.js'
import type { GateAnswers } from '../../../afk-runner/src/work/gate-answers.js'
import { settleGateWithAnswers } from '../../../afk-runner/src/work/gate-settle.js'
import type { SettleInput } from '../../../afk-runner/src/work/gate-settle.js'
import { TASK_TEXT, makeFakePipeline } from '../fixtures/fake-pipeline.js'
import type { FakePipeline } from '../fixtures/fake-pipeline.js'

const tmpDirs: string[] = []

afterEach(() => {
  while (tmpDirs.length > 0) {
    const dir = tmpDirs.pop()
    if (dir !== undefined) fs.rmSync(dir, { recursive: true, force: true })
  }
})

interface ReleaseHarness {
  readonly appended: EventInput[]
  readonly settleWith: (answers: GateAnswers) => ReturnType<typeof settleGateWithAnswers>
  readonly log: () => SddEvent[]
  readonly runDir: string
}

/** Narrow an answers settle to its settled shape — throws (failing the test) on a rejection. */
function settledOf(result: Awaited<ReturnType<typeof settleGateWithAnswers>>): { outcome: string } {
  if ('kind' in result) throw new Error(`expected a settled result, got rejection: ${result.reason}`)
  return result
}

/** The implement stage entries a settle appended — the release approve must add none. */
function implementEnters(events: readonly { readonly type: string; readonly stage?: string }[]): readonly unknown[] {
  return events.filter((event) => event.type === 'stage_enter' && event.stage === 'implement')
}

/**
 * A parked RELEASE gate (U3 D7): an armed run walked the full execution
 * half — final approve moved it into implement, the walk finished, verify
 * passed, release presented v2 — and the gate awaits its answer.
 */
function makeParkedReleaseGate(): ReleaseHarness {
  const runDir = fs.mkdtempSync(path.join(os.tmpdir(), 'afk-settle-release-'))
  tmpDirs.push(runDir)
  const changeDir = path.join(runDir, 'change')
  fs.mkdirSync(path.join(changeDir, 'specs'), { recursive: true })
  fs.writeFileSync(path.join(changeDir, 'proposal.md'), 'hello')
  fs.writeFileSync(path.join(changeDir, 'tasks.md'), '- [x] 1.1 first item\n')
  fs.writeFileSync(path.join(runDir, 'gate-hashes-2.json'), '{}\n')
  fs.writeFileSync(path.join(runDir, 'verify-1.log'), 'verdict: green\n')
  const appended: EventInput[] = []
  const emit = (event: EventInput): void => {
    appended.push(event)
  }
  const input: SettleInput = {
    gate: { emit, runDir, changeDir, driftCheck: (): Promise<void> => Promise.resolve() },
    version: 2,
    gateMode: 'release',
    expected: { assumptions: [], blockers: [], gateMode: 'release' },
    round: { current: 1, cap: 3 },
  }
  const PRELUDE: readonly EventInput[] = [
    { altitude: 'L2', type: 'execution', action: 'armed' },
    { altitude: 'L2', type: 'stage_enter', stage: 'intake' },
    { altitude: 'L2', type: 'depth', profile: 'S', rationale: 'one module', source: 'estimator' },
    { altitude: 'L2', type: 'stage_exit', stage: 'intake' },
    { altitude: 'L2', type: 'stage_enter', stage: 'draft' },
    { altitude: 'L2', type: 'stage_exit', stage: 'draft' },
    { altitude: 'L2', type: 'stage_enter', stage: 'review' },
    { altitude: 'L2', type: 'round_open', round: 1, cap: 3 },
    {
      altitude: 'L2',
      type: 'convergence',
      round: 1,
      verdict: 'converged',
      counts: { blocker: 0, material: 0, nitpick: 0 },
    },
    { altitude: 'L2', type: 'round_close', round: 1, cap: 3 },
    { altitude: 'L2', type: 'stage_exit', stage: 'review' },
    { altitude: 'L2', type: 'stage_enter', stage: 'decompose' },
    { altitude: 'L2', type: 'stage_enter', stage: 'gate' },
    { altitude: 'L2', type: 'gate', action: 'presented', mode: 'final', version: 1 },
    { altitude: 'L2', type: 'auto_decision', rule: 'none', decision: 'gate', evidenceDigest: 'x', gateVersion: 1 },
    { altitude: 'L2', type: 'stage_exit', stage: 'decompose' },
    { altitude: 'L2', type: 'stage_exit', stage: 'gate' },
    { altitude: 'L2', type: 'stage_enter', stage: 'implement' },
    { altitude: 'L2', type: 'gate', action: 'answered', mode: 'final', version: 1, outcome: 'approve' },
    { altitude: 'L2', type: 'task', action: 'started', id: '1' },
    { altitude: 'L2', type: 'task', action: 'done', id: '1' },
    { altitude: 'L2', type: 'stage_exit', stage: 'implement' },
    { altitude: 'L2', type: 'stage_enter', stage: 'verify' },
    { altitude: 'L2', type: 'stage_exit', stage: 'verify' },
    { altitude: 'L2', type: 'stage_enter', stage: 'release' },
    { altitude: 'L2', type: 'stage_enter', stage: 'gate' },
    { altitude: 'L2', type: 'gate', action: 'presented', mode: 'release', version: 2 },
    { altitude: 'L2', type: 'auto_decision', rule: 'none', decision: 'gate', evidenceDigest: 'x', gateVersion: 2 },
    { altitude: 'L2', type: 'stage_exit', stage: 'release' },
  ]
  const stamp = (events: readonly EventInput[]): SddEvent[] =>
    [...PRELUDE, ...events].map((event, index) => stampEvent(event, index + 1, '2026-09-03T00:00:00.000Z'))
  fs.writeFileSync(
    path.join(runDir, 'events.ndjson'),
    `${stamp([])
      .map((event) => JSON.stringify(event))
      .join('\n')}\n`,
  )
  return {
    appended,
    settleWith: (answers) => settleGateWithAnswers(input, answers),
    log: () => stamp(appended),
    runDir,
  }
}

/** The rejection reason of a settle result — throws (failing the test) when it settled instead. */
function rejectionOf(result: Awaited<ReturnType<typeof settleGateWithAnswers>>): string {
  if ('kind' in result) return result.reason
  throw new Error('expected a rejected settle, got a settled result')
}

describe('settle seam at release gates (U3 D7)', () => {
  it('approve appends exit-then-answer and completes — no implement mover even armed', async () => {
    const h = makeParkedReleaseGate()
    const result = settledOf(await h.settleWith({ items: [], blockerAnswers: [], acks: [], decision: 'approve' }))
    expect(result.outcome).toBe('approve')
    const events = h.log()
    expect(events.at(-2)).toMatchObject({ type: 'stage_exit', stage: 'gate' })
    expect(events.at(-1)).toMatchObject({ type: 'gate', action: 'answered', outcome: 'approve', mode: 'release' })
    const folded = foldEvents(pipelineMachine, events).snapshot
    expect(folded.value).toBe('completed')
    expect(folded.status).toBe('done')
    expect(implementEnters(h.appended)).toEqual([])
  })

  it('veto appends answer, exit, then the implement mover — and writes the redirect as the fix-context sidecar', async () => {
    const h = makeParkedReleaseGate()
    const result = settledOf(
      await h.settleWith({
        items: [],
        blockerAnswers: [],
        acks: [],
        decision: 'veto',
        gateVetoRedirect: 'tighten the error copy in verify-1',
      }),
    )
    expect(result.outcome).toBe('veto')
    const events = h.log()
    expect(events.at(-3)).toMatchObject({ type: 'gate', action: 'answered', outcome: 'veto', mode: 'release' })
    expect(events.at(-2)).toMatchObject({ type: 'stage_exit', stage: 'gate' })
    expect(events.at(-1)).toMatchObject({ type: 'stage_enter', stage: 'implement' })
    const folded = foldEvents(pipelineMachine, events).snapshot
    expect(folded.value).toBe('implement')
    expect(folded.context.stages['implement']).toBe('active')
    const sidecar = fs.readFileSync(path.join(h.runDir, 'release-veto.md'), 'utf8')
    expect(sidecar).toContain('tighten the error copy in verify-1')
  })

  it('abort appends the answered event alone and reaches the aborted final', async () => {
    const h = makeParkedReleaseGate()
    const result = settledOf(await h.settleWith({ items: [], blockerAnswers: [], acks: [], decision: 'abort' }))
    expect(result.outcome).toBe('abort')
    const events = h.log()
    expect(events.at(-1)).toMatchObject({ type: 'gate', action: 'answered', outcome: 'abort', mode: 'release' })
    const folded = foldEvents(pipelineMachine, events).snapshot
    expect(folded.value).toBe('aborted')
    expect(folded.status).toBe('done')
  })

  it('extend is rejected by the response grammar at a release gate', async () => {
    const h = makeParkedReleaseGate()
    const result = await h.settleWith({ items: [], blockerAnswers: [], acks: [], decision: 'extend' })
    expect(rejectionOf(result)).toMatch(/extend is not valid at a release gate/u)
    expect(h.appended).toEqual([])
  })
})

const TASKS_MD = ['## 1. Walk', '', '- [ ] 1.1 first item', '- [ ] 1.2 second item', ''].join('\n')

function fakeClock(): { readonly tick: () => Promise<void>; readonly release: () => void } {
  const queue: Array<() => void> = []
  return {
    tick: () =>
      new Promise<void>((resolve) => {
        queue.push(resolve)
      }),
    release: (): void => {
      const resolve = queue.shift()
      if (resolve !== undefined) resolve()
    },
  }
}

interface LoopHalt {
  readonly pipeline: FakePipeline
  readonly runDir: string
  readonly halted: { readonly halted: string; readonly position: string }
}

/** An armed run approved into the walk; the release gate is vetoed once, then its re-presentation is approved. */
async function vetoedThenApprovedRun(): Promise<LoopHalt> {
  const pipeline = makeFakePipeline({
    artifactOverrides: { 'decompose-tasks.json': TASKS_MD },
    sidecarOverrides: {
      'implement-t1.json': JSON.stringify({ files_written: ['src/one.ts'] }),
      'implement-t2.json': JSON.stringify({ files_written: ['src/two.ts'] }),
    },
  })
  const started = await startRun(pipeline.deps, { taskText: TASK_TEXT, execute: true })
  expect(started.halted).toBe('gate-pending')
  const runDir = pipeline.runDirOf(started.runId)
  fs.writeFileSync(
    path.join(runDir, 'gate-1.md'),
    '<!-- gate-1.md -->\n\n## Final gate\n\n## Gate response\n\nAPPROVE\n',
  )
  const clock = fakeClock()
  const state = { settled: false }
  const run = resumeRun({ ...pipeline.deps, gateWait: { tick: clock.tick } }, started.runId)
  const tracked = run.then(
    (value): LoopHalt => {
      state.settled = true
      return { pipeline, runDir, halted: value }
    },
    (error: unknown): never => {
      state.settled = true
      throw error
    },
  )
  let vetoed = false
  let approved = false
  const deadline = Date.now() + 30_000
  while (Date.now() < deadline && !state.settled) {
    clock.release()
    await new Promise((resolve) => {
      setTimeout(resolve, 2)
    })
    if (!vetoed && fs.existsSync(path.join(runDir, 'gate-2.md'))) {
      fs.writeFileSync(
        path.join(runDir, 'gate-2.md'),
        '<!-- gate-2.md -->\n\n## Gate response\n\nVETO: tighten the error copy\n',
      )
      vetoed = true
    }
    if (vetoed && !approved && fs.existsSync(path.join(runDir, 'gate-3.md'))) {
      fs.writeFileSync(path.join(runDir, 'gate-3.md'), '<!-- gate-3.md -->\n\n## Gate response\n\nAPPROVE\n')
      approved = true
    }
  }
  return tracked
}

/** The prompts one spawn basename recorded — empty when it never spawned. */
function promptsOf(pipeline: FakePipeline, basename: string): readonly string[] {
  return pipeline.spawnPrompts[basename] ?? []
}

/** The gate answered events as (version:outcome) tokens, log order. */
function answeredTokens(events: readonly SddEvent[]): readonly string[] {
  return events
    .filter(
      (event): event is Extract<SddEvent, { type: 'gate' }> => event.type === 'gate' && event.action === 'answered',
    )
    .map((event) => `${String(event.version)}:${String(event.outcome)}`)
}

describe('the release veto loop on the walk (U3 D7)', () => {
  it('veto re-enters implement with the redirect as fix context, re-verifies, re-presents, and approve completes', async () => {
    const h = await vetoedThenApprovedRun()
    const events = readEvents(path.join(h.runDir, 'events.ndjson'))
    const fixPrompts = promptsOf(h.pipeline, 'implement-t2.json')
    expect(fixPrompts.length).toBe(2)
    expect(fixPrompts[1]).toContain('tighten the error copy')
    const sidecar = fs.readFileSync(path.join(h.runDir, 'release-veto.md'), 'utf8')
    expect(sidecar.trimEnd().endsWith('fix answered: task 2')).toBe(true)
    expect(answeredTokens(events)).toEqual(['1:approve', '2:veto', '3:approve'])
    expect(h.halted.halted).toBe('final')
    expect(h.halted.position).toBe('completed')
    expect(events.filter((event) => event.type === 'stage_failed')).toEqual([])
  })
})
