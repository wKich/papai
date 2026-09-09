// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

import { z } from 'zod'

import { runAgent } from '../../review-loop/src/agent-runner.js'
import type { AgentUsage, SpawnFn } from '../../review-loop/src/agent-runner.js'
import { composeConfigContent } from './agent-config.js'
import { createAgentReporter } from './agent-reporter.js'
import { INACTIVITY_TIMEOUT_MS, WALL_CLOCK_TIMEOUT_MS } from './config.js'
import type { AgentRole } from './config.js'
import type { EventInput } from './events.js'
import { composeChildEnv, mcpFor } from './mcp-servers.js'
import type { AgentMcpSurface } from './mcp-servers.js'

/**
 * One spawn's invocation of review-loop's `runAgent`, split from
 * `agent-layer.ts` when the per-spawn child-env composition (afk-runner-agent-mcp
 * D3) pushed that file past `max-lines` — this module owns what a single spawn
 * sends (the argv inputs, the session-ledger hooks, and the composed
 * replacement env), while the layer keeps the attempt loop and the
 * spawned-event resolution around it. The two change for different reasons.
 */

/** Resume continuation (agent-layer D2): the opencode session id a continuation spawn re-attaches to. */
export interface ContinuationSpawn {
  readonly sessionId: string
}

/**
 * The deps slice one spawn needs: the transport, the event bus, and the
 * afk-runner-agent-mcp spawn inputs. `AgentLayerDeps` extends this, so the
 * layer's construction sites keep one shape.
 */
export interface SpawnDeps {
  readonly spawn: SpawnFn
  readonly emit: (event: EventInput) => void
  /**
   * The resolved agent-MCP surface (afk-runner-agent-mcp D1): present = every
   * spawn resolves `mcpFor(surface, role)` — for the spawned event's server
   * names and for the composed child env below; absent = inert, nothing
   * composed, the event byte-identical to a pre-change spawn.
   */
  readonly mcpSurface?: AgentMcpSurface
  /**
   * The DI'd ambient-env source (afk-runner-agent-mcp D3) — the one place
   * permitted to read the ambient env: absent reads `process.env` at spawn
   * time; injected sources keep tests hermetic. Never touched while the MCP
   * surface is inactive (D5 inertness).
   */
  readonly envSource?: () => Record<string, string | undefined>
}

/** One attempt's spawn inputs, as the layer's `prepareSpawnContext` assembles them. */
export interface SpawnInputs {
  readonly prompt: string
  readonly model: string
  readonly absoluteOutput: string
  readonly logPath: string
  readonly sessionLedger: { recordSessionId: (id: string, preferred: number) => void }
  readonly ledgerAttempt: number
  readonly reporter: ReturnType<typeof createAgentReporter>
  readonly continuation: ContinuationSpawn | null
  readonly attempt: number
}

export function runSpawn(
  deps: SpawnDeps,
  options: { readonly cwd: string; readonly label: string; readonly role: AgentRole },
  inputs: SpawnInputs,
): Promise<{ value: unknown; usage: AgentUsage }> {
  // Per-spawn child env (afk-runner-agent-mcp D3): the one afk-runner read of
  // the ambient env, through the DI'd source. An inactive surface composes
  // nothing — no env read, no `opencodeEnv`, inheritance untouched (D5). The
  // composed map carries credentials; it rides `runAgent`'s `opencodeEnv`
  // verbatim and reaches no log and no event payload.
  const surface = deps.mcpSurface
  const opencodeEnv =
    surface === undefined
      ? undefined
      : composeChildEnv(
          deps.envSource === undefined ? process.env : deps.envSource(),
          composeConfigContent(inputs.model, surface, mcpFor(surface, options.role)),
        )
  return runAgent({
    spawn: deps.spawn,
    model: inputs.model,
    cwd: options.cwd,
    prompt: inputs.prompt,
    outputPath: inputs.absoluteOutput,
    outputSchema: z.unknown(),
    label: options.label,
    logPath: inputs.logPath,
    extraArgs: inputs.continuation === null ? [] : ['--session', inputs.continuation.sessionId],
    noRetry: inputs.continuation !== null,
    timeoutMs: WALL_CLOCK_TIMEOUT_MS,
    inactivityTimeoutMs: INACTIVITY_TIMEOUT_MS,
    reporter: inputs.reporter,
    sessionLedger: inputs.sessionLedger,
    sessionAttempt: inputs.ledgerAttempt,
    opencodeEnv,
    onRetry: () => {
      deps.emit({ altitude: 'L1', type: 'retrying', agent: options.label, reason: 'stall', attempt: inputs.attempt })
    },
  })
}
