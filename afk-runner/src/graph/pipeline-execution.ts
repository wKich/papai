// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

/**
 * The execution-half state modules (U3 D4/D5/D7): implement's sequential
 * tasks.md walk, verify's compiled gate set, release's gate presentation.
 * Split from pipeline-work.ts at the max-lines seam — the registry there
 * composes these unchanged.
 */

import path from 'node:path'

import type { StateModule } from '../drive/loop.js'
import { releaseVetoOwed } from '../work/fix-target.js'
import { implementOutcomeOf, runImplementWork } from '../work/implement.js'
import { presentReleaseGate } from '../work/present-release.js'
import { bunRunCheck } from '../work/run-check.js'
import { readTaskItemsAt } from '../work/tasks-md.js'
import { newestVerifyVerdict, runVerifyWork, verifyOutcomeOf } from '../work/verify.js'
import { agentSeamsOf, sidecarDirOf } from './pipeline-agent.js'
import type { PipelineRunInput, PipelineWorkDeps } from './pipeline-work.js'

/**
 * The implement stage (U3 D4): one walked tasks.md item per work bracket —
 * the self-successor re-enters for the next item, and outcomeOf reads the
 * residue against the shared tasks.md parser (outstanding → re-entry, all
 * recorded done → verify).
 */
export function implementModule(deps: PipelineWorkDeps, input: PipelineRunInput, runDir: string): StateModule {
  const changeDir = path.join(deps.config.repoRoot, 'openspec', 'changes', input.changeName)
  return {
    work: {
      kind: 'implement',
      run: (io) =>
        runImplementWork(
          {
            agent: agentSeamsOf(deps, io),
            runDir: io.runDir,
            sidecarDir: sidecarDirOf(io),
            cwd: deps.config.repoRoot,
            runCheck: deps.runCheck ?? bunRunCheck,
          },
          { changeName: input.changeName },
          io,
        ),
    },
    // An unanswered red verdict or an unanswered release veto (the newest
    // verify log still ends with its verdict / the veto sidecar carries no
    // fix answer) re-owns implement even with every box checked — the fix
    // bracket must run, not route straight back to verify (D4/D5/D7).
    outcomeOf: (context) =>
      implementOutcomeOf(
        context,
        readTaskItemsAt(changeDir),
        newestVerifyVerdict(runDir) === 'red' || releaseVetoOwed(runDir),
      ),
    successors: {
      outstanding: { enter: 'implement' },
      done: { enter: 'verify' },
    },
  }
}

/**
 * The verify stage (U3 D5): the compiled gate set at the execution
 * boundary — a red suite routes back into implement as a normal outcome
 * (the log artifact is the fix context), a green boundary releases. The
 * verdict rides the run dir's verify-&lt;n&gt;.log, so the outcome reader
 * needs the run dir at construction.
 */
export function verifyModule(deps: PipelineWorkDeps, runDir: string): StateModule {
  return {
    work: {
      kind: 'verify',
      run: (io) =>
        runVerifyWork({ runCheck: deps.runCheck ?? bunRunCheck, runDir: io.runDir, cwd: deps.config.repoRoot }, io),
    },
    outcomeOf: (context) => verifyOutcomeOf(context, newestVerifyVerdict(runDir)),
    successors: {
      unverified: { enter: 'verify' },
      green: { enter: 'release' },
      red: { enter: 'implement' },
    },
  }
}

/**
 * The release stage (U3 D7): the release-gate presentation as the state's
 * only work act — files first, `stage_enter(gate)`, presented at
 * max-version+1, the ladder logging `rule none`. The bracket-closing exit
 * lands from `gate.awaiting` afterwards (the C5 choreography).
 */
export function releaseModule(deps: PipelineWorkDeps, input: PipelineRunInput): StateModule {
  return {
    work: {
      kind: 'release',
      run: (io) =>
        presentReleaseGate(
          {
            config: deps.config,
            repoRoot: deps.config.repoRoot,
            changeName: input.changeName,
            execGit: deps.execGit,
          },
          io,
        ).then(() => undefined),
    },
    outcomeOf: (context) => (context.stages['release'] === 'done' ? 'presented' : 'incomplete'),
    successors: {
      incomplete: { enter: 'release' },
      presented: { park: 'gate-pending' },
    },
  }
}
