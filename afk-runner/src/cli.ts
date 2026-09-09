// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

import path from 'node:path'

import type { SpawnFn } from '../../review-loop/src/agent-runner.js'
import { realSpawn } from '../../review-loop/src/spawn.js'
import { renderRunsReport, summarizeWorkDir } from './accounting.js'
import { typedSpawn } from './agent-seam.js'
import { buildCorpusReport } from './analyze-corpus.js'
import { loadCorpus } from './analyze-io.js'
import { nodeAnalyzeFs } from './analyze-io.js'
import { readOnlyGit } from './analyze-io.js'
import { renderCorpusJson, renderCorpusReport } from './analyze-report.js'
import { groundTruthJoin } from './analyze-truth.js'
import { fullStateSummary, runCli } from './cli-summary.js'
import type { ExecGitFn, RunnerConfig } from './config.js'
import { resolveRunnerConfig } from './config.js'
import { resolveAgentMcp } from './mcp-servers.js'
import { foldRun, logPathOf } from './memo-project.js'
import { createOpenSpecDriver } from './openspec-driver.js'
import type { ExecFn } from './openspec-driver.js'
import { resumeRun } from './run-resume.js'
import { stopRunOperator } from './run-stop.js'
import type { OperatorStop } from './run-stop.js'
import { startRun, statusRun } from './run.js'
import type { RunDeps } from './run.js'
import { parseStartArgs } from './start-args.js'
export { parseStartArgs } from './start-args.js'
export type { StartArgs } from './start-args.js'
import { parseServeArgs } from './serve/args.js'
import { startBoardServer } from './serve/server.js'
import type { BoardOptions } from './serve/server.js'
import { oneSecondTick } from './work/gate-waiter.js'
import { buildRunReport } from './work/report.js'

const EXEC_GIT: ExecGitFn = (cwd, args) => {
  const proc = Bun.spawnSync(['git', '-C', cwd, ...args], {
    stdout: 'pipe',
    stderr: 'pipe',
  })
  return Promise.resolve({
    stdout: new TextDecoder().decode(proc.stdout),
    stderr: new TextDecoder().decode(proc.stderr),
  })
}

const EXEC_OPENSPEC: ExecFn = (args, options) => {
  const proc = Bun.spawnSync([...args], {
    cwd: options.cwd,
    stdout: 'pipe',
    stderr: 'pipe',
  })
  return Promise.resolve({
    stdout: new TextDecoder().decode(proc.stdout),
    stderr: new TextDecoder().decode(proc.stderr),
    exitCode: proc.exitCode ?? 1,
  })
}

export interface CliDeps extends RunDeps {
  readonly spawn: SpawnFn
}

/** Pure sync deps assembler over a resolved config (D7): the verbs own resolution, never the seam. */
export function defaultCliDeps(config: RunnerConfig): CliDeps {
  return {
    config,
    spawn: typedSpawn(realSpawn),
    execGit: EXEC_GIT,
    driver: createOpenSpecDriver({ exec: EXEC_OPENSPEC, cwd: config.repoRoot }),
    // The waiter rides the resume verb only (R4 D2): start parks and exits,
    // resume attends a gate-pending park in the foreground.
    gateWait: { tick: oneSecondTick },
  }
}

/**
 * The verb-dispatch injection seam (afk-runner-agent-mcp D1): production
 * passes nothing — the config ladder resolves and the real deps assemble
 * inside `cliMain` — while tests inject the operator env record (the input
 * the spawning verbs' MCP gate reads) and a deps set (config, spawn seam,
 * execGit, driver), keeping the verb boundary exercisable hermetically: no
 * real `opencode` spawn ever runs.
 */
export interface CliMainIo {
  /** The operator env record; absent reads `process.env`. */
  readonly env?: Record<string, string | undefined>
  /** Fully-formed deps carrying their own config; absent resolves the ladder and assembles the real deps. */
  readonly deps?: CliDeps
}

export async function runStartCommand(deps: RunDeps, args: readonly string[]): Promise<string> {
  const { taskFile, depthOverride, execute } = parseStartArgs(args)
  // Never-on-start (R4 D2): start drives to park and exits — the foreground
  // waiter belongs to resume, so a machine-invoked start never blocks a shell.
  const result = await startRun({ ...deps, gateWait: undefined }, { taskFile, depthOverride, execute })
  const lines = [`run: ${result.runId}`, `halted: ${result.halted}`, `position: ${result.position}`]
  if (result.halted === 'gate-pending') {
    const runDir = path.join(deps.config.workDir, 'runs', result.runId)
    const version = foldRun(logPathOf(runDir)).context.gate?.version ?? 1
    lines.push(`resume: afk-runner resume ${result.runId} — answer ${path.join(runDir, `gate-${version}.md`)}`)
  }
  const summary = lines.join('\n')
  console.log(summary)
  return summary
}

export async function runStatusCommand(deps: RunDeps, runId: string): Promise<string> {
  const status = await statusRun(deps, runId)
  const lines = [`run: ${runId}`, fullStateSummary(status)]
  if (status.parked === 'final') lines.push(`report: afk-runner report ${runId}`)
  const summary = lines.join('\n')
  console.log(summary)
  return summary
}

/** The passive report command (C5 D8): `report <runId> [--pr]` prints the summary without writing run state. */
export async function runReportCommand(deps: RunDeps, args: readonly string[]): Promise<string> {
  const runId = args[0]
  if (runId === undefined || runId.length === 0) throw new Error('usage: afk-runner report <runId> [--pr]')
  const pr = args.includes('--pr')
  const report = await buildRunReport({ config: deps.config, execGit: deps.execGit }, runId, pr)
  console.log(report)
  return report
}

/** The passive cross-run roster (U9 report half): `runs` prints rows + totals without writing anything. */
export async function runRunsCommand(deps: RunDeps): Promise<string> {
  const report = renderRunsReport(await summarizeWorkDir(deps.config.workDir))
  console.log(report)
  return report
}

export type BoardStarter = (options: BoardOptions) => Promise<{ url: string; token: string; stop(): Promise<void> }>

/**
 * The serve verb (web-board D7/D8): a config-consuming, strictly read-only
 * verb — it starts the token-gated board over the resolved work dir, prints
 * the ready-to-open URL once, and never attends, presents, or settles a run.
 */
export async function runServeCommand(
  deps: RunDeps,
  args: readonly string[],
  starter: BoardStarter = startBoardServer,
): Promise<string> {
  const parsed = parseServeArgs(args)
  const options: BoardOptions = {
    workDir: deps.config.workDir,
    ...(parsed.host === undefined ? {} : { host: parsed.host }),
    ...(parsed.port === undefined ? {} : { port: parsed.port }),
    ...(parsed.token === undefined ? {} : { token: parsed.token }),
  }
  const handle = await starter(options)
  const summary = `board ready: ${handle.url}`
  console.log(summary)
  return summary
}

/**
 * The corpus-analysis verb (run-analysis D8): `analyze [workdirs…] [--json]`
 * over the read-only seams — it never attends, presents, or settles any
 * gate, and writes nothing but its own stdout.
 */
export async function runAnalyzeCommand(deps: RunDeps, args: readonly string[]): Promise<string> {
  const json = args.includes('--json')
  const workdirs = args.filter((arg) => arg !== '--json')
  const dirs = workdirs.length > 0 ? workdirs : [deps.config.workDir]
  const fs = nodeAnalyzeFs()
  const bundles = await loadCorpus(fs, dirs)
  const changes = bundles.flatMap((bundle): readonly { repoRoot: string; changeName: string }[] => {
    const changeName = bundle.state?.changeName
    if (changeName === undefined) return []
    return [{ repoRoot: bundle.state?.repoRoot ?? deps.config.repoRoot, changeName }]
  })
  const groundTruth = await groundTruthJoin(fs, readOnlyGit(deps.execGit), changes)
  const report = buildCorpusReport(bundles, groundTruth, { now: new Date() })
  const output = json ? renderCorpusJson(report) : renderCorpusReport(report)
  console.log(output)
  return output
}

export async function runResumeCommand(deps: RunDeps, runId: string): Promise<string> {
  const result = await resumeRun(deps, runId)
  const lines = [
    `run: ${result.runId}`,
    `halted: ${result.halted}`,
    `position: ${result.position}`,
    `resumed: ${result.drove ? 're-entered work' : 'already parked'}`,
  ]
  const summary = lines.join('\n')
  console.log(summary)
  return summary
}

/** Outcome → the operator line the stop verb prints (C6 D7). */
export function stopMessageOf(result: OperatorStop, steerPath: string): string {
  if (result.kind === 'calm-requested') {
    return `calm stop requested for ${result.runId} — honored at the next boundary`
  }
  if (result.kind === 'aborted') {
    return `run ${result.runId} aborted by operator — the session id is released`
  }
  if (result.kind === 'gate-pending') {
    return `run ${result.runId} awaits a gate decision — write 'abort' to ${steerPath} to end it`
  }
  return `run ${result.runId} is already final (${result.position}) — nothing to stop`
}

/** The stop verb (C6 D7): calm-stop marker for live runs, `run_abort` for dead ones. */
export async function runStopCommand(deps: RunDeps, runId: string): Promise<string> {
  const result = await stopRunOperator(deps, runId)
  const steerPath = path.join(deps.config.workDir, 'runs', runId, 'steer.md')
  const summary = stopMessageOf(result, steerPath)
  console.log(summary)
  return summary
}

function printUsage(): void {
  console.log(
    [
      'usage:',
      '  afk-runner start <taskFile> [--depth S|M|L] [--execute]   drive a fresh run to park (armed: plan + execute)',
      '  afk-runner status <runId>                     print the folded full-state summary',
      '  afk-runner resume <runId>                     re-enter an interrupted or parked run',
      '  afk-runner stop <runId>                       calm-stop a live run; abort a dead one',
      '  afk-runner report <runId> [--pr]              print the passive run report',
      '  afk-runner runs                               print the passive cross-run roster and totals',
      '  afk-runner analyze [workdirs…] [--json]       print the read-only corpus report',
      '  afk-runner serve [--host <addr>] [--port <port>] [--token <token>]',
      '                                                serve the read-only web board',
      '  afk-runner <runDir>                           print the fold summary of a run dir',
    ].join('\n'),
  )
}

export async function cliMain(argv: readonly string[], io: CliMainIo = {}): Promise<string | undefined> {
  const [command, ...rest] = argv
  if (
    command === 'start' ||
    command === 'status' ||
    command === 'resume' ||
    command === 'report' ||
    command === 'stop' ||
    command === 'runs' ||
    command === 'analyze' ||
    command === 'serve'
  ) {
    const env = io.env ?? process.env
    const resolved = io.deps ?? defaultCliDeps(await resolveRunnerConfig(process.cwd(), env))
    // The verb-time MCP gate (afk-runner-agent-mcp D1): only the verbs that
    // can spawn agents or spend budget resolve the operator surface, and the
    // refusal lands here — after the config ladder, before any run work,
    // agent spawn, or budget spend. The non-spawning verbs skip the step
    // entirely: env knobs are per-invocation and more volatile than the
    // config file, and stop — the calm-stop channel for a live
    // budget-burning run — must not be lost to an unrelated MCP typo.
    const surface =
      command === 'start' || command === 'resume' ? resolveAgentMcp(env, resolved.config.model) : undefined
    const deps = surface === undefined ? resolved : { ...resolved, mcpSurface: surface }
    for (const warning of surface?.warnings ?? []) console.error(`warning: ${warning}`)
    if (command === 'start') return runStartCommand(deps, rest)
    if (command === 'report') return runReportCommand(deps, rest)
    if (command === 'runs') return runRunsCommand(deps)
    if (command === 'analyze') return runAnalyzeCommand(deps, rest)
    if (command === 'serve') return runServeCommand(deps, rest)
    if (command === 'stop') {
      const runId = rest[0]
      if (runId === undefined || runId.length === 0) throw new Error('usage: afk-runner stop <runId>')
      return runStopCommand(deps, runId)
    }
    const runId = rest[0]
    if (runId === undefined || runId.length === 0) throw new Error(`usage: afk-runner ${command} <runId>`)
    return command === 'status' ? runStatusCommand(deps, runId) : runResumeCommand(deps, runId)
  }
  if (argv.length === 1 && argv[0] !== 'help') return Promise.resolve(runCli(argv))
  printUsage()
  return Promise.resolve(undefined)
}

const argv = process.argv.slice(2)
if (argv.length > 0 && import.meta.main) {
  void cliMain(argv)
}
