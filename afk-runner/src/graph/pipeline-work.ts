// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

import path from 'node:path'

import type { SpawnFn } from '../../../review-loop/src/agent-runner.js'
import type { AgentLayerDeps } from '../agent-layer.js'
import type { ExecGitFn, RunnerConfig } from '../config.js'
import type { StateModule, StopSeam, WorkFor, WorkIO } from '../drive/loop.js'
import type { DepthProfile, EventInput } from '../events.js'
import type { KernelContext } from '../kernel/machine.js'
import type { OpenSpecDriver } from '../openspec-driver.js'
import { runAtomicity } from '../work/atomicity.js'
import { runDecompose, runsAtomicity } from '../work/decompose.js'
import { runDraft } from '../work/draft.js'
import { runIntake } from '../work/intake.js'
import { presentFinalGate } from '../work/present-final.js'
import { reviewOutcomeOf, runReviewWork } from '../work/review.js'
import type { RunCheckFn } from '../work/run-check.js'
import { runVetoRevision } from '../work/veto-revision.js'
import { GATE_AWAITING_MODULE, agentSeamsOf, sidecarDirOf } from './pipeline-agent.js'
import { implementModule, releaseModule, verifyModule } from './pipeline-execution.js'

export interface PipelineWorkDeps {
  readonly spawn: SpawnFn
  readonly execGit: ExecGitFn
  readonly driver: OpenSpecDriver
  readonly config: RunnerConfig
  readonly conventions?: string
  readonly stdout?: (line: string) => void
  /** Calm-stop seam consulted by the review loop between rounds. */
  readonly stop?: { readonly stopRequested: () => boolean }
  /** Command runner for the execution-half checks (per-task affected check, verify boundary); defaults to Bun. */
  readonly runCheck?: RunCheckFn
}

export interface PipelineRunInput {
  readonly taskText: string
  readonly changeName: string
  readonly depthOverride?: DepthProfile
}

/**
 * The pipeline's state modules: work declarations co-located with the
 * outcome→successor data (design D3). The drive loop consumes only this
 * registry — adding C5's tail states means adding modules here, not loop
 * edits. Tail states (decompose/atomicity) declare no work and the loop
 * parks awaiting-tail instead of entering them; `gate.awaiting` (C4) is the
 * positional park of a presented gate — no work, parks gate-pending until a
 * settle producer answers through the seam.
 */
/**
 * A settled veto re-enters draft: the gate is answered with outcome veto (design D8). */
function isVetoRevision(context: KernelContext): boolean {
  return context.gate !== null && context.gate.answered && context.gateOutcome === 'veto'
}

/** The decompose outcome as a pure reader: work owed until done, then depth picks the successor (C5 D1). */
export function decomposeOutcomeOf(context: KernelContext): 'incomplete' | 'converged' | 'presented' {
  if (context.stages['decompose'] !== 'done') return 'incomplete'
  return runsAtomicity(context.depth ?? 'S') ? 'converged' : 'presented'
}

/** The atomicity outcome: work owed until done, then the presentation has parked the run (C5 D1). */
export function atomicityOutcomeOf(context: KernelContext): 'incomplete' | 'presented' {
  return context.stages['atomicity'] === 'done' ? 'presented' : 'incomplete'
}

/** The decompose stage work: the legacy decomposer copy, then (depth S) the final-gate presentation as its last act. */
async function runDecomposeStage(deps: PipelineWorkDeps, input: PipelineRunInput, io: WorkIO): Promise<void> {
  await runDecompose(
    {
      driver: deps.driver,
      agent: agentOf(deps, io),
      runDir: io.runDir,
      sidecarDir: path.join(io.runDir, 'sidecars'),
      cwd: deps.config.repoRoot,
    },
    { changeName: input.changeName },
  )
  if (!runsAtomicity(io.context.depth ?? 'S')) {
    await presentFinalGate({ config: deps.config, repoRoot: deps.config.repoRoot, changeName: input.changeName }, io)
  }
}

/** The atomicity stage work: the legacy atomicity copy, then the final-gate presentation as its last act. */
async function runAtomicityStage(deps: PipelineWorkDeps, input: PipelineRunInput, io: WorkIO): Promise<void> {
  await runAtomicity(
    {
      driver: deps.driver,
      agent: agentOf(deps, io),
      runDir: io.runDir,
      sidecarDir: path.join(io.runDir, 'sidecars'),
      cwd: deps.config.repoRoot,
    },
    { changeName: input.changeName, depth: io.context.depth ?? 'S' },
  )
  await presentFinalGate({ config: deps.config, repoRoot: deps.config.repoRoot, changeName: input.changeName }, io)
}

function agentOf(deps: PipelineWorkDeps, io: WorkIO): AgentLayerDeps {
  return {
    spawn: deps.spawn,
    config: deps.config,
    execGit: deps.execGit,
    emit: (event: EventInput): void => {
      io.append(event)
    },
  }
}

const START_MODULE: StateModule = { work: null, outcomeOf: () => 'boot', successors: { boot: { enter: 'intake' } } }

function intakeModule(deps: PipelineWorkDeps, input: PipelineRunInput): StateModule {
  return {
    work: {
      kind: 'intake',
      run: (io) =>
        runIntake(
          {
            driver: deps.driver,
            agent: agentSeamsOf(deps, io),
            emit: (event: EventInput): void => {
              io.append(event)
            },
            sidecarDir: sidecarDirOf(io),
            runDir: io.runDir,
            cwd: deps.config.repoRoot,
            stdout: (line) => deps.stdout?.(`intake: ${line}`),
          },
          { changeName: input.changeName, taskText: input.taskText, depthOverride: input.depthOverride },
        ).then(() => undefined),
    },
    outcomeOf: (context) => (context.depth === null ? 'incomplete' : 'done'),
    successors: { done: { enter: 'draft' } },
  }
}

function draftModule(deps: PipelineWorkDeps, input: PipelineRunInput): StateModule {
  return {
    work: {
      kind: 'draft',
      run: (io) =>
        isVetoRevision(io.context)
          ? runVetoRevision(deps, input, io)
          : runDraft(
              {
                driver: deps.driver,
                agent: agentSeamsOf(deps, io),
                runDir: io.runDir,
                sidecarDir: sidecarDirOf(io),
                cwd: deps.config.repoRoot,
              },
              { changeName: input.changeName, taskText: input.taskText, depth: io.context.depth ?? 'S' },
            ),
    },
    outcomeOf: (context) => (context.stages['draft'] === 'done' ? 'done' : 'incomplete'),
    successors: { done: { enter: 'review' } },
  }
}

function reviewModule(deps: PipelineWorkDeps, input: PipelineRunInput): StateModule {
  return {
    work: {
      kind: 'review',
      run: (io) =>
        runReviewWork(
          {
            agent: { spawn: deps.spawn, config: deps.config, execGit: deps.execGit },
            repoRoot: deps.config.repoRoot,
            changeName: input.changeName,
            taskText: input.taskText,
            conventions: deps.conventions ?? '',
            ...(deps.stop === undefined ? {} : { stop: deps.stop }),
            ...(deps.stdout === undefined ? {} : { onSteerWarning: (line: string) => deps.stdout?.(`steer: ${line}`) }),
          },
          io,
        ).then(() => undefined),
    },
    outcomeOf: reviewOutcomeOf,
    successors: {
      converged: { enter: 'decompose' },
      'cap-hit': { park: 'gate-pending' },
      // The round still owes work — an extended round opened by a gate
      // settle, a crashed mid-round, a fresh entry: review re-runs itself.
      incomplete: { enter: 'review' },
    },
  }
}

function decomposeModule(deps: PipelineWorkDeps, input: PipelineRunInput): StateModule {
  return {
    work: { kind: 'decompose', run: (io) => runDecomposeStage(deps, input, io) },
    outcomeOf: decomposeOutcomeOf,
    successors: {
      incomplete: { enter: 'decompose' },
      converged: { enter: 'atomicity' },
      presented: { park: 'gate-pending' },
    },
  }
}

function atomicityModule(deps: PipelineWorkDeps, input: PipelineRunInput): StateModule {
  return {
    work: { kind: 'atomicity', run: (io) => runAtomicityStage(deps, input, io) },
    outcomeOf: atomicityOutcomeOf,
    successors: {
      incomplete: { enter: 'atomicity' },
      presented: { park: 'gate-pending' },
    },
  }
}

export function createPipelineWorkFor(deps: PipelineWorkDeps, input: PipelineRunInput, runDir: string): WorkFor {
  return (state): StateModule | null => {
    if (state === 'start') return START_MODULE
    if (state === 'intake') return intakeModule(deps, input)
    if (state === 'draft') return draftModule(deps, input)
    if (state === 'review') return reviewModule(deps, input)
    if (state === 'decompose') return decomposeModule(deps, input)
    if (state === 'atomicity') return atomicityModule(deps, input)
    if (state === 'implement') return implementModule(deps, input, runDir)
    if (state === 'verify') return verifyModule(deps, runDir)
    if (state === 'release') return releaseModule(deps, input)
    if (state === 'gate.awaiting') return GATE_AWAITING_MODULE
    return null
  }
}

/** The RunDeps-shaped seam adapter: wires the run seams (+optional stop) into the work registry. */
export function workForOf(
  deps: Omit<PipelineWorkDeps, 'stop'> & { readonly stop?: StopSeam },
  input: { readonly taskText: string; readonly changeName: string; readonly depthOverride?: DepthProfile },
  runDir: string,
): WorkFor {
  const { stop, ...rest } = deps
  return createPipelineWorkFor({ ...rest, ...(stop === undefined ? {} : { stop }) }, input, runDir)
}
