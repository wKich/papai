// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

import { existsSync } from 'node:fs'
import path from 'node:path'

/**
 * The one composition seam between the loop and its agent subprocesses
 * (design D2): `attemptRun` delegates here instead of naming a binary, so
 * the opencode route is byte-identical by construction.
 */

/** A refused composition — raised before anything spawns, so no partial spend can follow it. */
export class AgentCommandError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'AgentCommandError'
  }
}

export interface AgentCommand {
  command: string
  args: readonly string[]
  /** The child's entire replacement environment; absent inherits `process.env`. */
  env?: Record<string, string>
}

export interface AgentCommandOptions {
  model: string
  cwd: string
  prompt: string
  extraArgs: readonly string[]
  label: string
  /**
   * Continuation session id (escalation-retry-session-continuation D4):
   * `--session <id>` — absent adds no flag.
   */
  continueSessionId?: string
  /**
   * The opencode child's entire replacement environment, caller-composed — the
   * builder never reads ambient `process.env` (afk-runner-agent-mcp D3).
   * Returned verbatim as `AgentCommand.env`; absent stays `undefined`, so
   * `realSpawn` inherits `process.env` byte-identically.
   */
  opencodeEnv?: Record<string, string>
}

function opencodeCommand(options: AgentCommandOptions): AgentCommand {
  return {
    command: 'opencode',
    args: [
      'run',
      '--auto',
      '--format',
      'json',
      '--model',
      options.model,
      '--dir',
      options.cwd,
      ...options.extraArgs,
      ...(options.continueSessionId === undefined ? [] : ['--session', options.continueSessionId]),
      options.prompt,
    ],
    ...(options.opencodeEnv === undefined ? {} : { env: options.opencodeEnv }),
  }
}

/**
 * Absolute path the agent should write its output to.
 *
 * The path is absolute (not relative) so the agent cannot mis-resolve it
 * against an unrelated project root. The worktree cwd itself often lives at
 * `<repoRoot>/.review-loop/worktrees/<runId>/`, and a relative path like
 * `.review-loop/matches.json` is ambiguous: the agent may resolve it against
 * the worktree cwd (correct) or against the project root two levels up
 * (`<repoRoot>/.review-loop/matches.json` — wrong). The runner always reads
 * from `<cwd>/.review-loop/<basename(outputPath)>`, so the prompt must direct
 * the agent there unambiguously.
 */
export function agentWritePath(cwd: string, outputPath: string): string {
  return path.resolve(cwd, '.review-loop', path.basename(outputPath))
}

const MISPLACEMENT_SEARCH_DEPTH = 8

export function findMisplacedScratches(expectedPath: string, cwd: string, basename: string): string[] {
  const expected = path.resolve(expectedPath)
  const found: string[] = []
  let current = path.resolve(cwd)
  for (let i = 0; i < MISPLACEMENT_SEARCH_DEPTH; i += 1) {
    const candidate = path.resolve(current, '.review-loop', basename)
    if (candidate !== expected && existsSync(candidate)) {
      found.push(candidate)
    }
    const parent = path.dirname(current)
    if (parent === current) break
    current = parent
  }
  return found
}

/**
 * Composes one agent invocation: today's opencode argv and, when the caller
 * composed one, the verbatim `opencodeEnv` as the child env — absent,
 * `realSpawn` inherits `process.env` exactly as before.
 */
export function buildAgentCommand(options: AgentCommandOptions): AgentCommand {
  return opencodeCommand(options)
}
