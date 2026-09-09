// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

import { copyFile, mkdir, readFile, unlink } from 'node:fs/promises'
import path from 'node:path'

import type { z } from 'zod'

import { agentWritePath, buildAgentCommand, findMisplacedScratches } from './agent-command.js'
import { createLineHandler, enqueueLog } from './line-handler.js'
import type { LineHandler, SessionLedgerSeam } from './line-handler.js'
import type { ProgressReporter } from './progress-log.js'
import type { AgentUsage } from './run-stats.js'
import type { LineSink, SpawnFn, SpawnResult } from './spawn.js'

export { agentWritePath, findMisplacedScratches } from './agent-command.js'
export type { LineSink, SpawnFn, SpawnResult } from './spawn.js'
export { emptyUsage } from './run-stats.js'
export type { AgentUsage } from './run-stats.js'
export { createLineHandler } from './line-handler.js'
export type { LineHandler, SessionLedgerSeam } from './line-handler.js'

export interface AgentRunResult<T> {
  value: T
  usage: AgentUsage
}

export class AgentRunError extends Error {
  readonly usage: AgentUsage
  constructor(message: string, usage: AgentUsage) {
    super(message)
    this.name = 'AgentRunError'
    this.usage = usage
  }
}

export interface RunAgentOptions<T> {
  spawn: SpawnFn
  model: string
  cwd: string
  prompt: string
  outputPath: string
  outputSchema: z.ZodType<T>
  label: string
  /**
   * Slot identity for live rendering; defaults to `label`. Callers that run
   * several agents as one on-screen unit (mutation-improve's iteration) pass a
   * shared key so each agent's live line replaces the previous one in place.
   */
  slotKey?: string
  /**
   * When false, dispose leaves the slot live instead of committing it — the
   * unit's owner (e.g. the mutation-improve pipeline) commits once at the end.
   */
  commitOnDispose?: boolean
  logPath: string
  extraArgs: readonly string[]
  reporter?: ProgressReporter
  onRetry?: () => void
  timeoutMs?: number
  inactivityTimeoutMs?: number
  /**
   * Session-capture seam (D1): called once, the moment the first
   * session-bearing event line of this spawn arrives. The host records the id
   * synchronously so a crash mid-agent still leaves it on disk.
   */
  sessionLedger?: SessionLedgerSeam
  /** Preferred ledger attempt number for this spawn (default 1). */
  sessionAttempt?: number
  /**
   * Fail fast instead of retrying a soft failure once. Resume continuations
   * set this: their fallback path is the caller's prompt-rebuild spawn, not a
   * second continuation of a session that may no longer exist.
   */
  noRetry?: boolean
  /**
   * The opencode child's entire replacement env, caller-composed (afk-runner-agent-mcp D3);
   * threaded verbatim to `buildAgentCommand`.
   */
  opencodeEnv?: Record<string, string>
}

interface AttemptResult<T> {
  ok: true
  value: T
}

interface AttemptError {
  ok: false
  error: Error
  timedOut: boolean
  stalled: boolean
}

type Attempt<T> = AttemptResult<T> | AttemptError

function attemptRun<T>(
  options: RunAgentOptions<T>,
  onLine?: LineSink,
  continueSessionId?: string,
): Promise<SpawnResult> {
  const command = buildAgentCommand({
    model: options.model,
    cwd: options.cwd,
    prompt: options.prompt,
    extraArgs: options.extraArgs,
    label: options.label,
    continueSessionId,
    opencodeEnv: options.opencodeEnv,
  })
  return options.spawn(
    command.command,
    command.args,
    {
      cwd: options.cwd,
      timeout: options.timeoutMs,
      inactivityTimeoutMs: options.inactivityTimeoutMs,
      env: command.env,
    },
    onLine,
  )
}

/**
 * The non-zero-exit attempt failure: both the enqueued stderr line and the
 * error message flow from this one copy, which later persists into
 * needs-human reasoning.
 */
function spawnFailure<T>(
  options: RunAgentOptions<T>,
  handler: LineHandler,
  result: { exitCode: number; stderr: string; timedOut?: boolean; stalled?: boolean },
): Attempt<T> {
  enqueueLog(handler.ctx, `[${options.label}] stderr: ${result.stderr}\n`)
  return {
    ok: false,
    error: new Error(`${options.label} exited with code ${result.exitCode}: ${result.stderr}`),
    timedOut: result.timedOut === true,
    stalled: result.stalled === true,
  }
}

async function runAttempt<T>(
  options: RunAgentOptions<T>,
  handler: LineHandler,
  continueSessionId?: string,
): Promise<Attempt<T>> {
  await mkdir(path.resolve(options.cwd, '.review-loop'), { recursive: true })
  // Re-arm session capture: a stall retry is a fresh opencode session, and its
  // id must be recorded even though the first attempt already captured one.
  handler.ctx.sessionId = null
  const result = await attemptRun(options, handler.onLine, continueSessionId)
  if (result.exitCode !== 0) return spawnFailure(options, handler, result)
  return exchangeOutput(options)
}

/**
 * The file-based output exchange's accept step, split from `runAttempt` to
 * keep that function under `max-lines-per-function`. Reads the agent's
 * scratch, copies it to the destination and validates the schema; a missing
 * scratch keeps the backend-agnostic misplaced-scratch diagnosis.
 */
async function exchangeOutput<T>(options: RunAgentOptions<T>): Promise<Attempt<T>> {
  try {
    const agentFile = agentWritePath(options.cwd, options.outputPath)
    await mkdir(path.dirname(options.outputPath), { recursive: true })
    await copyFile(agentFile, options.outputPath)
    await unlink(agentFile)
    const raw = await readFile(options.outputPath, 'utf8')
    return { ok: true, value: options.outputSchema.parse(JSON.parse(raw)) }
  } catch (error) {
    const isEnoent =
      error !== null && typeof error === 'object' && 'code' in error && (error as { code?: unknown }).code === 'ENOENT'
    if (isEnoent) {
      const misplaced = findMisplacedScratches(
        agentWritePath(options.cwd, options.outputPath),
        options.cwd,
        path.basename(options.outputPath),
      )
      const hint = misplaced.length === 0 ? '' : ` Possible misplaced file(s): ${misplaced.join(', ')}.`
      const agentFile = agentWritePath(options.cwd, options.outputPath)
      return {
        ok: false,
        error: new Error(`${options.label} did not write to the expected scratch path: ${agentFile}.${hint}`),
        timedOut: false,
        stalled: false,
      }
    }
    return {
      ok: false,
      error: error instanceof Error ? error : new Error(String(error)),
      timedOut: false,
      stalled: false,
    }
  }
}

export async function runAgent<T>(options: RunAgentOptions<T>): Promise<AgentRunResult<T>> {
  const handler = createLineHandler(options)
  const buildUsage = (): AgentUsage => ({
    ...handler.ctx.usage,
    wallMs: handler.ctx.firstStepAt === null ? 0 : Date.now() - handler.ctx.firstStepAt,
  })
  const finalize = (value: T): AgentRunResult<T> => ({ value, usage: buildUsage() })
  try {
    const first = await runAttempt(options, handler)
    if (first.ok) return finalize(first.value)
    // Wall-clock timeouts are not retried (the task genuinely overran its
    // budget), but stalls are: a hung provider stream is transient, and the
    // retry usually lands on a healthy request path.
    if (first.timedOut && !first.stalled) throw new AgentRunError(first.error.message, buildUsage())
    if (options.noRetry === true) throw new AgentRunError(first.error.message, buildUsage())
    options.onRetry?.()
    // The stall retry continues the captured session when one exists
    // (escalation-retry-session-continuation D4): the id sits on the line
    // handler's ctx — only this layer can reach it — and the command builder
    // maps it to `--session`. No captured id degrades to today's fresh re-spawn.
    const continueSessionId = handler.ctx.sessionId ?? undefined
    const second = await runAttempt(options, handler, continueSessionId)
    if (second.ok) return finalize(second.value)
    throw new AgentRunError(second.error.message, buildUsage())
  } finally {
    await handler.dispose()
  }
}
