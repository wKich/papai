// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

import path from 'node:path'

import type { AgentLayerDeps } from '../agent-layer.js'
import type { StateModule, WorkIO } from '../drive/loop.js'
import type { EventInput } from '../events.js'
import type { PipelineWorkDeps } from './pipeline-work.js'

/** The sidecar directory of a run — where spawn seams write their validated outputs. */
export function sidecarDirOf(io: WorkIO): string {
  return path.join(io.runDir, 'sidecars')
}

/** The agent-layer seams one spawn needs, wired through the work io's append boundary. */
export function agentSeamsOf(deps: PipelineWorkDeps, io: WorkIO): AgentLayerDeps {
  return {
    spawn: deps.spawn,
    config: deps.config,
    execGit: deps.execGit,
    emit: (event: EventInput): void => {
      io.append(event)
    },
  }
}

/** The no-work park module of the gate compound (C4). */
export const GATE_AWAITING_MODULE: StateModule = {
  work: null,
  outcomeOf: () => 'awaiting',
  successors: { awaiting: { park: 'gate-pending' } },
}
