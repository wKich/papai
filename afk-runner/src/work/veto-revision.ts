// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

import fs from 'node:fs'
import path from 'node:path'

import type { SpawnFn } from '../../../review-loop/src/agent-runner.js'
import type { ExecGitFn, RunnerConfig } from '../config.js'
import type { WorkIO } from '../drive/loop.js'
import type { OpenSpecDriver } from '../openspec-driver.js'
import { parseGateResponse } from './gate-model.js'
import { expectedContentFor } from './gate-settle.js'
import { runVetoUpdater, updateAssumptionsFromVetoes } from './veto-updater.js'

/** Structural seam over PipelineWorkDeps — the veto revision reads only these four deps. */
export interface VetoRevisionDeps {
  readonly driver: OpenSpecDriver
  readonly spawn: SpawnFn
  readonly config: RunnerConfig
  readonly execGit: ExecGitFn
}

export interface VetoRevisionInput {
  readonly changeName: string
}

/**
 * The veto-updater revision round (C4 D8, D6): read the vetoes from the
 * settled gate file — per-item and whole-gate alike — fold the item vetoes
 * back into the resolver sidecar, and run one resolver pass that applies the
 * redirects to the existing artifacts. The no-op path requires an
 * empty item-veto list AND no gate-level veto: a settled outcome of veto
 * must never skip revision silently.
 */
export async function runVetoRevision(deps: VetoRevisionDeps, input: VetoRevisionInput, io: WorkIO): Promise<void> {
  const runDir = io.runDir
  const sidecarDir = path.join(runDir, 'sidecars')
  const version = io.context.gate?.version ?? 1
  const round = io.context.round?.current ?? 1
  const gateMode = io.context.gate?.mode === 'early' ? 'early' : 'final'
  const md = await fs.promises.readFile(path.join(runDir, `gate-${version}.md`), 'utf8')
  const expected = await expectedContentFor(sidecarDir, round, gateMode)
  const response = parseGateResponse(md, expected)
  if (response.vetoes.length === 0 && response.gateVetoRedirect === null) return
  await updateAssumptionsFromVetoes(sidecarDir, round, response.vetoes)
  await runVetoUpdater(
    {
      driver: deps.driver,
      agent: {
        spawn: deps.spawn,
        config: deps.config,
        execGit: deps.execGit,
        emit: (event) => {
          io.append(event)
        },
      },
      runDir,
      sidecarDir,
      cwd: deps.config.repoRoot,
    },
    {
      changeName: input.changeName,
      round,
      vetoes: response.vetoes,
      ...(response.gateVetoRedirect === null ? {} : { gateRedirect: response.gateVetoRedirect }),
    },
  )
}
