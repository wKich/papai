// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

import path from 'node:path'

import type { ExecGitFn, RunnerConfig } from '../config.js'
import { autonomyOf } from '../config.js'
import type { WorkIO } from '../drive/loop.js'
import type { SddEvent } from '../events.js'
import { readEvents } from '../events.js'
import { pipelineMachine } from '../graph/pipeline.js'
import { foldEvents } from '../kernel/fold.js'
import type { KernelContext } from '../kernel/machine.js'
import { readChangeDigest } from './gate-digest-extract.js'
import { writeGateFiles } from './gate-files.js'
import type { ExecutionDigest, GateDigestInput } from './gate-model.js'
import { runGatePrelude } from './gate-prelude.js'
import { gatherGateSignals } from './gate-signals.js'
import type { GateSignals } from './gate-signals.js'
import type { ReviewLoopResult } from './review-loop.js'
import { readTaskItemsAt } from './tasks-md.js'
import { verifyOutcomeLines } from './verify.js'

export interface PresentReleaseDeps {
  readonly config: RunnerConfig
  readonly repoRoot: string
  readonly changeName: string
  readonly execGit: ExecGitFn
}

export interface PresentReleaseResult {
  readonly version: number
}

/** The empty review result a release gate presents with — the execution digest is its content (U3 D7). */
const RELEASE_REVIEW_RESULT = {
  outcome: 'converged',
  rounds: 0,
  verdict: 'converged',
  raised: { blocker: 0, material: 0, nitpick: 0 },
  openBlockers: [],
  openMaterial: [],
  openNitpicks: [],
} as const satisfies ReviewLoopResult

/** The run's own commits since run start — runner-made slice commits, listed for the operator (U3 D7). */
async function commitsOf(deps: PresentReleaseDeps, startedAt: string): Promise<readonly string[]> {
  const { stdout } = await deps.execGit(deps.repoRoot, ['log', '--format=%s', `--since=${startedAt}`])
  return stdout
    .split('\n')
    .map((line) => line.trim())
    .filter((line) => line.length > 0)
}

/**
 * The release-gate presentation (U3 D7): files first, `stage_enter(gate)`,
 * the presented event at max-version+1, then the always-logging ladder with
 * every rung suppressed (`rule none` — no auto-settle kinds widened). The
 * gate carries the execution digest; extend is rejected by the response
 * grammar, not offered by this rendering.
 */
/** The execution digest (U3 D7): walk counts from the residue and tasks.md, boundary verdicts and run commits from the artifacts. */
async function executionDigestOf(
  deps: PresentReleaseDeps,
  runDir: string,
  changeDir: string,
  events: readonly SddEvent[],
  settled: KernelContext,
): Promise<ExecutionDigest> {
  const startedAt = events[0]?.ts ?? new Date().toISOString()
  const tasksDone = Object.values(settled.tasks).filter((record) => record.status === 'done').length
  return {
    tasksDone,
    tasksTotal: readTaskItemsAt(changeDir).length,
    verifyOutcomes: verifyOutcomeLines(runDir),
    commits: await commitsOf(deps, startedAt),
  }
}

/** The release gate's digest input (U3 D7): no review items — cost/duration from the signals, the execution digest beside the change digest. */
async function releaseDigestInput(
  deps: PresentReleaseDeps,
  bound: {
    readonly runDir: string
    readonly changeDir: string
    readonly version: number
    readonly signals: GateSignals
    readonly executionDigest: ExecutionDigest
  },
): Promise<GateDigestInput> {
  return {
    version: bound.version,
    mode: 'release',
    changeName: deps.changeName,
    runId: path.basename(bound.runDir),
    assumptions: [],
    blockers: [],
    openMaterial: [],
    openNitpicks: [],
    trajectory: [],
    capHitFired: false,
    summary: deps.changeName,
    costUsd: bound.signals.costUsd,
    costKnown: bound.signals.costKnown,
    durationMs: bound.signals.durationMs,
    changeDigest: await readChangeDigest(bound.changeDir),
    executionDigest: bound.executionDigest,
  }
}

export async function presentReleaseGate(deps: PresentReleaseDeps, io: WorkIO): Promise<PresentReleaseResult> {
  const runDir = io.runDir
  const logPath = path.join(runDir, 'events.ndjson')
  const sidecarDir = path.join(runDir, 'sidecars')
  const changeDir = path.join(deps.repoRoot, 'openspec', 'changes', deps.changeName)
  const events = readEvents(logPath)
  const settled = foldEvents(pipelineMachine, events).snapshot.context
  const version = (settled.gate?.version ?? 0) + 1
  const round = settled.round?.current ?? 1
  const signals = await gatherGateSignals(
    sidecarDir,
    round,
    settled,
    events,
    events[0]?.ts ?? new Date().toISOString(),
    new Date(),
  )
  const executionDigest = await executionDigestOf(deps, runDir, changeDir, events, settled)
  await writeGateFiles(
    { emit: (): void => undefined, runDir, changeDir, driftCheck: () => Promise.resolve() },
    await releaseDigestInput(deps, { runDir, changeDir, version, signals, executionDigest }),
  )
  io.append({ altitude: 'L2', type: 'stage_enter', stage: 'gate' })
  io.append({ altitude: 'L2', type: 'gate', action: 'presented', mode: 'release', version })
  await runGatePrelude({
    version,
    mode: 'release',
    reviewResult: RELEASE_REVIEW_RESULT,
    context: refoldContext(logPath),
    events: readEvents(logPath),
    sidecarDir,
    changeDir,
    runDir,
    repoRoot: deps.repoRoot,
    emit: (event): void => {
      io.append(event)
    },
    autonomy: autonomyOf(deps.config),
  })
  return { version }
}

function refoldContext(logPath: string): KernelContext {
  return foldEvents(pipelineMachine, readEvents(logPath)).snapshot.context
}
