// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

import { afterEach, describe, expect, it } from 'bun:test'
import assert from 'node:assert'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'

import { composeConfigContent } from '../../afk-runner/src/agent-config.js'
import {
  runResumeCommand,
  runRunsCommand,
  runServeCommand,
  runStartCommand,
  runStatusCommand,
  runAnalyzeCommand,
  cliMain,
  parseStartArgs,
} from '../../afk-runner/src/cli.js'
import { resolveRunnerConfig } from '../../afk-runner/src/config.js'
import { readEvents } from '../../afk-runner/src/events.js'
import { mcpFor, resolveAgentMcp } from '../../afk-runner/src/mcp-servers.js'
import type { RunDeps } from '../../afk-runner/src/run.js'
import type { BoardHandle, BoardOptions } from '../../afk-runner/src/serve/server.js'
import { BLOCKER_ROUND, TASK_TEXT, makeFakePipeline } from './fixtures/fake-pipeline.js'
import { assertEach, type Row } from './grouped-assertions.js'

/** The run id from a start-command summary's first line. */
function runIdOf(summary: string): string {
  const first = summary.split('\n')[0]
  return first === undefined ? '' : first.replace('run: ', '')
}

/** Truncate the log to everything up to and including the first event of a type (crash simulation). */
function truncateAfterFirst(logPath: string, type: string): void {
  const events = readEvents(logPath)
  const cut = events.findIndex((event) => event.type === type)
  const keep = cut === -1 ? events.length - 1 : cut
  const truncated = events.filter((_event, index) => index <= keep)
  fs.writeFileSync(logPath, truncated.map((event) => JSON.stringify(event)).join('\n') + '\n')
}

/** How many times review was entered in the log. */
function reviewEnterCount(logPath: string): number {
  return readEvents(logPath).filter((event) => event.type === 'stage_enter' && event.stage === 'review').length
}

/** The first run id under a fake pipeline's work dir. */
function firstRunOf(pipeline: ReturnType<typeof makeFakePipeline>): string {
  const entries = fs.readdirSync(path.join(pipeline.workDir, 'runs'))
  return entries[0] ?? ''
}

/** Fake clock: each tick resolves only when the test releases it. */
function fakeClock(): { readonly tick: () => Promise<void>; readonly release: () => void } {
  const queue: Array<() => void> = []
  return {
    tick: () =>
      new Promise<void>((resolve) => {
        queue.push(resolve)
      }),
    release: () => {
      const resolve = queue.shift()
      if (resolve !== undefined) resolve()
    },
  }
}

/**
 * Release ticks until the path exists on disk — a fixed tick count races the
 * presentation write's fs window under load (the wall-clock bound keeps releasing
 * while the write is still in flight).
 */
async function ticksUntilFile(
  clock: { readonly release: () => void },
  filePath: string,
  budgetMs = 10_000,
): Promise<boolean> {
  const deadline = Date.now() + budgetMs
  while (Date.now() < deadline) {
    if (fs.existsSync(filePath)) return true
    clock.release()
    await new Promise((resolve) => {
      setTimeout(resolve, 2)
    })
  }
  return fs.existsSync(filePath)
}

/** Answer a cap-hit blocker gate by hand: override the blocker, approve the gate. */
function overrideCapHitBlocker(gateMd: string): void {
  const md = fs.readFileSync(gateMd, 'utf8').replace('→ <answer or OVERRIDE>', '→ OVERRIDE')
  fs.writeFileSync(gateMd, `${md}\nAPPROVE\n`)
}

describe('afk-runner cli launch resolution (the config ladder reaches every verb)', () => {
  const makeRoot = (): string => fs.mkdtempSync(path.join(os.tmpdir(), 'sdd-cli-resolution-'))
  const roots: string[] = []
  const originalCwd = process.cwd()
  afterEach(() => {
    while (roots.length > 0) {
      const dir = roots.pop()
      if (dir !== undefined) fs.rmSync(dir, { recursive: true, force: true })
    }
    process.chdir(originalCwd)
  })

  it('a present config file is wholesale-authoritative for the verb — its workDir governs the roster', async () => {
    const root = makeRoot()
    roots.push(root)
    fs.mkdirSync(path.join(root, '.afk-runner'), { recursive: true })
    fs.mkdirSync(path.join(root, 'bookkeeping'), { recursive: true })
    fs.writeFileSync(
      path.join(root, '.afk-runner', 'config.json'),
      JSON.stringify({ repoRoot: root, workDir: 'bookkeeping', model: 'file-model', budget: null }),
    )
    const previous = process.cwd()
    process.chdir(root)
    const out = await cliMain(['runs'])
    process.chdir(previous)
    expect(out).toContain('totals: 0 runs')
  })

  it('an invalid config file fails the verb before any run work, naming the offending key', async () => {
    const root = makeRoot()
    roots.push(root)
    fs.mkdirSync(path.join(root, '.afk-runner'), { recursive: true })
    fs.writeFileSync(
      path.join(root, '.afk-runner', 'config.json'),
      JSON.stringify({ repoRoot: root, model: 'm', budgetUsd: 3 }),
    )
    process.chdir(root)
    await expect(cliMain(['runs'])).rejects.toThrow(/budgetUsd/u)
    process.chdir(originalCwd)
  })
})

describe('afk-runner cli commands (fake agents)', () => {
  it('start drives a fresh think-half run to park and prints the halt', async () => {
    const pipeline = makeFakePipeline()
    const taskFile = path.join(pipeline.repoRoot, 'task.md')
    fs.writeFileSync(taskFile, TASK_TEXT)
    const summary = await runStartCommand(pipeline.deps, [taskFile])
    expect(summary).toContain('halted: final')
    const runId = runIdOf(summary)
    expect(fs.existsSync(path.join(pipeline.runDirOf(runId), 'events.ndjson'))).toBe(true)
  })

  it('status prints the folded full-state summary', async () => {
    const pipeline = makeFakePipeline()
    const taskFile = path.join(pipeline.repoRoot, 'task.md')
    fs.writeFileSync(taskFile, TASK_TEXT)
    const started = await runStartCommand(pipeline.deps, [taskFile])
    const runId = runIdOf(started)
    const summary = await runStatusCommand(pipeline.deps, runId)
    expect(summary).toContain('value: completed')
    expect(summary).toContain('depth: S')
    expect(summary).toContain('round: 1/1')
    expect(summary).toContain('last verdict: converged')
    expect(summary).toContain('gate: final v1 answered')
    expect(summary).toContain('halted: final')
    expect(summary).toContain('report: afk-runner report add-thing')
  })

  it('resume re-enters an interrupted think-half run through the review self-loop', async () => {
    const pipeline = makeFakePipeline()
    const taskFile = path.join(pipeline.repoRoot, 'task.md')
    fs.writeFileSync(taskFile, TASK_TEXT)
    await runStartCommand(pipeline.deps, [taskFile])
    const runId = firstRunOf(pipeline)
    const logPath = path.join(pipeline.runDirOf(runId), 'events.ndjson')

    // simulate a crash mid-review: drop everything after round_open(1)
    truncateAfterFirst(logPath, 'round_open')
    fs.rmSync(path.join(pipeline.runDirOf(runId), 'state.json'))

    const summary = await runResumeCommand(pipeline.deps, runId)
    expect(summary).toContain('halted: final')
    expect(summary).toContain('resumed: re-entered work')

    expect(reviewEnterCount(logPath)).toBe(2)
  })
})

describe('afk-runner cli start args (parseStartArgs)', () => {
  it('parses a task file with and without a --depth override', () => {
    expect(parseStartArgs(['task.md', '--depth', 'S'])).toEqual({ taskFile: 'task.md', depthOverride: 'S' })
    expect(parseStartArgs(['task.md'])).toEqual({ taskFile: 'task.md' })
  })

  it('keeps the invalid --depth error', () => {
    expect(() => parseStartArgs(['task.md', '--depth', 'X'])).toThrow("invalid --depth 'X' (expected S, M, or L)")
  })

  it('keeps the usage error on a missing task file', () => {
    expect(() => parseStartArgs([])).toThrow('usage: afk-runner start <taskFile> [--depth S|M|L] [--execute]')
  })

  it('parses the boolean --execute flag alone and beside --depth (U3 D1)', () => {
    expect(parseStartArgs(['task.md', '--execute'])).toEqual({ taskFile: 'task.md', execute: true })
    expect(parseStartArgs(['task.md', '--depth', 'S', '--execute'])).toEqual({
      taskFile: 'task.md',
      depthOverride: 'S',
      execute: true,
    })
    expect(parseStartArgs(['task.md'])).toEqual({ taskFile: 'task.md' })
  })

  it('rejects unexpected tokens and value-taking misspellings of the execute flag', () => {
    expect(() => parseStartArgs(['task.md', '--execute', 'yes'])).toThrow(
      "unexpected start argument 'yes' (usage: afk-runner start <taskFile> [--depth S|M|L] [--execute])",
    )
    expect(() => parseStartArgs(['task.md', '--exec'])).toThrow(/unexpected start argument/u)
  })
})

/** A documented flag token with its value form, from the doc's backticked `--flag value` prose. */
interface DocFlag {
  readonly flag: string
  readonly valueForm: string
}

/** Extract every backticked `--flag value-form` token the doc names. */
function documentedFlags(doc: string): DocFlag[] {
  return [...doc.matchAll(/`(--[a-z][a-z0-9-]*(?: [^`]*)?)`/gu)].map((m) => {
    const text = m[1] ?? ''
    const space = text.indexOf(' ')
    return space === -1
      ? { flag: text, valueForm: '' }
      : { flag: text.slice(0, space), valueForm: text.slice(space + 1) }
  })
}

/** The argv a documented value form implies: the flag plus its first alternative (`S|M|L` → `S`). */
function argvFor(entry: DocFlag): readonly string[] {
  const first = entry.valueForm.split('|')[0]?.trim() ?? ''
  return first === '' ? ['task.md', entry.flag] : ['task.md', entry.flag, first]
}

/**
 * Accepted = parses without error AND is not silently ignored: the result must
 * differ from the no-flag baseline, so an unknown flag the lenient parser would
 * drop on the floor still trips the pin.
 */
function acceptedByStartParsing(entry: DocFlag): boolean {
  const baseline = JSON.stringify(parseStartArgs(['task.md']))
  try {
    return JSON.stringify(parseStartArgs(argvFor(entry))) !== baseline
  } catch {
    return false
  }
}

describe('sdd-auto command doc flag pin', () => {
  it('every documented flag parses through the start argument parsing with its documented value form', () => {
    const doc = fs.readFileSync(new URL('../../.claude/commands/sdd-auto.md', import.meta.url), 'utf8')
    const flags = documentedFlags(doc)
    // Today's inventory is exactly --depth and --execute (U3); a doc that adds
    // or renames a flag fails here until the pin (and parser) consciously follow.
    expect(flags.map((entry) => entry.flag)).toEqual(['--depth', '--execute'])
    for (const entry of flags) {
      expect(acceptedByStartParsing(entry)).toBe(true)
    }
  })

  it('flags a documented flag the start parsing ignores (doctored-doc tripwire)', () => {
    const doctored = 'Pass the optional `--depth S|M|L` flag, or `--wait 5` to stall.'
    const rejected = documentedFlags(doctored).filter((entry) => !acceptedByStartParsing(entry))
    expect(rejected.map((entry) => entry.flag)).toEqual(['--wait'])
  })
})

describe('afk-runner cli attach policy (start parks, resume attends)', () => {
  it('start parks and exits at a gate: zero gateWait ticks, pointer names the gate file and the resume command', async () => {
    const pipeline = makeFakePipeline({ sidecarOverrides: BLOCKER_ROUND })
    const taskFile = path.join(pipeline.repoRoot, 'task.md')
    fs.writeFileSync(taskFile, TASK_TEXT)
    let ticks = 0
    const gateWait = {
      tick: (): Promise<void> => {
        ticks += 1
        return Promise.reject(new Error('start must not attach the gate waiter (R4 D2)'))
      },
    }

    const summary = await runStartCommand({ ...pipeline.deps, gateWait }, [taskFile])

    expect(summary).toContain('halted: gate-pending')
    expect(ticks).toBe(0)
    const runId = firstRunOf(pipeline)
    const gatePath = path.join(pipeline.runDirOf(runId), 'gate-1.md')
    expect(fs.existsSync(gatePath)).toBe(true)
    expect(summary).toContain(gatePath)
    expect(summary).toContain(`resume ${runId}`)
  })

  it('resume attaches the foreground waiter at a gate-pending park and settles through released ticks', async () => {
    const pipeline = makeFakePipeline({ sidecarOverrides: BLOCKER_ROUND })
    const taskFile = path.join(pipeline.repoRoot, 'task.md')
    fs.writeFileSync(taskFile, TASK_TEXT)
    await runStartCommand(pipeline.deps, [taskFile])
    const runId = firstRunOf(pipeline)
    const runDir = pipeline.runDirOf(runId)
    overrideCapHitBlocker(path.join(runDir, 'gate-1.md'))

    const clock = fakeClock()
    const resumed = runResumeCommand({ ...pipeline.deps, gateWait: { tick: clock.tick } }, runId)

    // attached: the resume holds in the waiter instead of reporting the park
    const beforeTick = await Promise.race([
      resumed.then((): string => 'returned'),
      new Promise((resolve) => {
        setTimeout((): void => resolve('pending'), 25)
      }),
    ])
    expect(beforeTick).toBe('pending')

    // released ticks settle v1; the re-drive presents the final gate (gate-2.md)
    expect(await ticksUntilFile(clock, path.join(runDir, 'gate-2.md'))).toBe(true)
    // the waiter holds for the v2 answer — Ctrl-C is the operator's exit
    void resumed
  })
})

describe('afk-runner serve verb (the read-only web board)', () => {
  /** A starter double that captures its options and never opens a socket. */
  function fakeStarter(captured: BoardOptions[]): (options: BoardOptions) => Promise<BoardHandle> {
    return (options) => {
      captured.push(options)
      return Promise.resolve({
        url: 'http://127.0.0.1:4545/?token=t0k3n',
        token: 't0k3n',
        stop: () => Promise.resolve(),
      })
    }
  }

  it('starts the board over the ladder-resolved work dir and prints the ready URL once', async () => {
    const pipeline = makeFakePipeline()
    const captured: BoardOptions[] = []
    const summary = await runServeCommand(pipeline.deps, ['--port', '8080', '--token', 's3cret'], fakeStarter(captured))
    expect(summary).toBe('board ready: http://127.0.0.1:4545/?token=t0k3n')
    expect(captured).toHaveLength(1)
    expect(captured[0]?.workDir).toBe(pipeline.deps.config.workDir)
    expect(captured[0]?.port).toBe(8080)
    expect(captured[0]?.token).toBe('s3cret')
  })

  it('serve resolves its work dir through the same ladder — a file-declared workDir governs', async () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'sdd-cli-serve-'))
    cliTmpDirs.push(root)
    fs.mkdirSync(path.join(root, '.afk-runner'), { recursive: true })
    fs.mkdirSync(path.join(root, 'bookkeeping'), { recursive: true })
    fs.writeFileSync(
      path.join(root, '.afk-runner', 'config.json'),
      JSON.stringify({ repoRoot: root, workDir: 'bookkeeping', model: 'file-model', budget: null }),
    )
    const config = await resolveRunnerConfig(root)
    const captured: BoardOptions[] = []
    await runServeCommand({ ...makeFakePipeline().deps, config }, [], fakeStarter(captured))
    expect(captured[0]?.workDir).toBe(path.join(root, 'bookkeeping'))
  })

  it('a bad serve flag fails the verb with the serve usage line', async () => {
    const pipeline = makeFakePipeline()
    await expect(runServeCommand(pipeline.deps, ['--por', '1'], fakeStarter([]))).rejects.toThrow(
      /usage: afk-runner serve/u,
    )
  })

  it('the usage inventory names the serve verb with its flags', async () => {
    const lines: string[] = []
    const original = console.log
    console.log = (line: string): void => {
      lines.push(line)
    }
    try {
      await cliMain(['help'])
    } finally {
      console.log = original
    }
    const usage = lines.join('\n')
    expect(usage).toContain('serve [--host <addr>] [--port <port>] [--token <token>]')
  })
})

const cliTmpDirs: string[] = []

afterEach(() => {
  while (cliTmpDirs.length > 0) {
    const dir = cliTmpDirs.pop()
    if (dir !== undefined) fs.rmSync(dir, { recursive: true, force: true })
  }
})

/** Content + mtime snapshot of every file under dir (the passive-read-only oracle). */
function snapshotTree(dir: string): Record<string, { content: string; mtimeMs: number }> {
  const snap: Record<string, { content: string; mtimeMs: number }> = {}
  const walk = (current: string): void => {
    for (const entry of fs.readdirSync(current, { withFileTypes: true })) {
      const full = path.join(current, entry.name)
      if (entry.isDirectory()) walk(full)
      else {
        const stat = fs.statSync(full)
        snap[path.relative(dir, full)] = { content: fs.readFileSync(full, 'utf8'), mtimeMs: stat.mtimeMs }
      }
    }
  }
  walk(dir)
  return snap
}

function writeRunsFixture(workDir: string): void {
  const T0 = Date.parse('2026-01-01T00:00:00.000Z')
  const usage = (inputTokens: number): string =>
    JSON.stringify({
      inputTokens,
      outputTokens: 0,
      reasoningTokens: 0,
      cachedReadTokens: 0,
      cachedWriteTokens: 0,
      costUsd: 0,
      wallMs: 0,
    })
  const runs: readonly {
    readonly id: string
    readonly state: Record<string, unknown>
    readonly log: readonly string[]
  }[] = [
    {
      id: 'done-run',
      state: { status: 'completed', gate: null, changeName: 'done-run', updatedAt: '2026-01-01T02:00:00.000Z' },
      log: [
        `{"altitude":"L1","type":"done","agent":"impl","usage":${usage(12_000_000)},"seq":1,"ts":"2026-01-01T00:00:00.000Z"}`,
        `{"altitude":"L1","type":"done","agent":"impl","usage":${usage(1_200_000)},"seq":2,"ts":"2026-01-01T01:00:00.000Z"}`,
      ],
    },
    {
      id: 'gate-run',
      state: {
        status: 'running',
        gate: { mode: 'escalation', version: 2 },
        changeName: 'gate-run',
        updatedAt: '2026-01-01T03:00:00.000Z',
      },
      log: [
        `{"altitude":"L2","type":"stage_enter","stage":"intake","seq":1,"ts":"2026-01-01T00:00:00.000Z"}`,
        `{"altitude":"L2","type":"gate","action":"presented","mode":"escalation","version":2,"seq":2,"ts":"2026-01-01T00:10:00.000Z"}`,
        `{"altitude":"L1","type":"done","agent":"impl","usage":${usage(5_000)},"seq":3,"ts":"2026-01-01T02:30:00.000Z"}`,
      ],
    },
  ]
  for (const run of runs) {
    const runDir = path.join(workDir, 'runs', run.id)
    fs.mkdirSync(runDir, { recursive: true })
    fs.writeFileSync(path.join(runDir, 'state.json'), `${JSON.stringify({ runId: run.id, ...run.state }, null, 2)}\n`)
    fs.writeFileSync(path.join(runDir, 'events.ndjson'), `${run.log.join('\n')}\n`)
  }
  void T0
}

describe('afk-runner runs command (cross-run accounting)', () => {
  it('prints the roster and totals footer without touching any file under the work dir', async () => {
    const workDir = fs.mkdtempSync(path.join(os.tmpdir(), 'afk-runs-cli-'))
    cliTmpDirs.push(workDir)
    writeRunsFixture(workDir)
    const pipeline = makeFakePipeline()
    const deps = { ...pipeline.deps, config: { ...pipeline.deps.config, workDir } }

    const before = snapshotTree(workDir)
    const summary = await runRunsCommand(deps)

    expect(summary).toContain('done-run')
    expect(summary).toContain('gate-run')
    expect(summary).toContain('gate:escalation v2')
    expect(summary).toContain('totals: 2 runs')
    expect(summary).toContain('gate-pending: 1')
    expect(summary).toContain('cost: ≥ $0.00 (2 unpriced)')
    expect(snapshotTree(workDir)).toEqual(before)
  })
})

describe('afk-runner analyze command (read-only corpus report)', () => {
  it('routes by workdir paths, completes a gate-pending corpus byte-unchanged, and prints the report', async () => {
    const workDir = fs.mkdtempSync(path.join(os.tmpdir(), 'afk-analyze-cli-'))
    cliTmpDirs.push(workDir)
    writeRunsFixture(workDir)
    const pipeline = makeFakePipeline()
    const deps = { ...pipeline.deps, config: { ...pipeline.deps.config, workDir } }

    const before = snapshotTree(workDir)
    const summary = await runAnalyzeCommand(deps, [workDir])

    expect(summary).toContain('afk-runner corpus analysis')
    expect(summary).toContain('## run gate-run')
    expect(summary).toContain('never-answered')
    expect(summary).toContain('## corpus')
    // the gate-pending run is neither presented, settled, nor routed anywhere
    expect(snapshotTree(workDir)).toEqual(before)
  })

  it('defaults to the configured workdir when no workdir args are given', async () => {
    const workDir = fs.mkdtempSync(path.join(os.tmpdir(), 'afk-analyze-def-'))
    cliTmpDirs.push(workDir)
    writeRunsFixture(workDir)
    const pipeline = makeFakePipeline()
    const deps = { ...pipeline.deps, config: { ...pipeline.deps.config, workDir } }

    const summary = await runAnalyzeCommand(deps, [])
    expect(summary).toContain('## run gate-run')
    expect(summary).toContain('## run done-run')
  })

  it('--json emits the same structure machine-readably', async () => {
    const workDir = fs.mkdtempSync(path.join(os.tmpdir(), 'afk-analyze-json-'))
    cliTmpDirs.push(workDir)
    writeRunsFixture(workDir)
    const pipeline = makeFakePipeline()
    const deps = { ...pipeline.deps, config: { ...pipeline.deps.config, workDir } }

    const raw = await runAnalyzeCommand(deps, [workDir, '--json'])
    const parsed: unknown = JSON.parse(raw)
    expect(parsed).toMatchObject({
      runs: [{ runId: 'done-run' }, { runId: 'gate-run' }],
      aggregates: { runsAggregated: 2 },
    })
  })

  it('the usage inventory names the analyze verb', async () => {
    const lines: string[] = []
    const original = console.log
    console.log = (line: string): void => {
      lines.push(line)
    }
    try {
      await cliMain(['help'])
    } finally {
      console.log = original
    }
    const usage = lines.join('\n')
    expect(usage).toContain('analyze [workdirs…] [--json]')
  })
})

describe('afk-runner cli verb-time MCP gate (afk-runner-agent-mcp D1)', () => {
  /** A base map one discriminator short of valid: refused naming the knob and the shape problem. */
  const INVALID_ENV: Record<string, string | undefined> = {
    AGENT_MCP_SERVERS: '{"notes":{"command":["uvx","mcp-notes"]}}',
  }
  /** The spec's valid declaration: one local server, one remote, and a reviewer narrowing entry. */
  const VALID_ENV: Record<string, string | undefined> = {
    AGENT_MCP_SERVERS: JSON.stringify({
      notes: { type: 'local', command: ['uvx', 'mcp-notes'] },
      search: { type: 'remote', url: 'https://mcp.example.test/search' },
    }),
    AGENT_MCP_ROLE_NARROWING: JSON.stringify({ reviewer: ['notes'] }),
  }

  /**
   * An execGit that answers branch discovery (report's commits line needs a
   * branch; the fake pipeline's default execGit yields none).
   */
  const branchYieldingExecGit: RunDeps['execGit'] = (_cwd, args) =>
    Promise.resolve({ stdout: args.includes('branch') ? 'main\n' : '', stderr: '' })

  /** A spawn seam that records each spawn's composed child env by output basename, delegating to the inner fake. */
  const envCapturingSpawn = (
    inner: RunDeps['spawn'],
    childEnvByBasename: Record<string, Record<string, string>>,
  ): RunDeps['spawn'] => {
    const spawn: RunDeps['spawn'] = (command, args, options, onLine) => {
      const prompt = String(args[args.length - 1])
      const basename = prompt.match(/\.review-loop\/([\w-]+\.json)/u)?.[1] ?? 'unknown.json'
      if (options.env !== undefined) childEnvByBasename[basename] = options.env
      return inner(command, args, options, onLine)
    }
    return spawn
  }

  it('an invalid AGENT_MCP_SERVERS fails start before any spawn or spend, naming the offending key', async () => {
    const pipeline = makeFakePipeline()
    const taskFile = path.join(pipeline.repoRoot, 'task.md')
    fs.writeFileSync(taskFile, TASK_TEXT)
    let spawns = 0
    const deps: RunDeps = {
      ...pipeline.deps,
      spawn: (command, args, options, onLine) => {
        spawns += 1
        return pipeline.deps.spawn(command, args, options, onLine)
      },
    }

    await expect(cliMain(['start', taskFile], { env: INVALID_ENV, deps })).rejects.toThrow(/AGENT_MCP_SERVERS/u)
    await expect(cliMain(['start', taskFile], { env: INVALID_ENV, deps })).rejects.toThrow(/valid MCP server map/u)

    // before any run work: no spawn ran and no run directory was created
    expect(spawns).toBe(0)
    expect(fs.existsSync(path.join(pipeline.workDir, 'runs'))).toBe(false)
  })

  it('the same invalid knob fails resume the same way — before the run is even read', async () => {
    const pipeline = makeFakePipeline()
    // a ghost run id: without the gate, resume would fail on the missing run
    // instead — so this pins the refusal's order, not just its existence
    await expect(cliMain(['resume', 'ghost-run'], { env: INVALID_ENV, deps: pipeline.deps })).rejects.toThrow(
      /AGENT_MCP_SERVERS/u,
    )
  })

  it('the same invalid knob leaves every non-spawning verb ungated', async () => {
    const pipeline = makeFakePipeline()
    const taskFile = path.join(pipeline.repoRoot, 'task.md')
    fs.writeFileSync(taskFile, TASK_TEXT)
    const started = await runStartCommand(pipeline.deps, [taskFile])
    const runId = runIdOf(started)
    const deps: RunDeps = { ...pipeline.deps, execGit: branchYieldingExecGit }

    const rows: readonly Row<{ readonly argv: readonly string[]; readonly flavor: string }>[] = [
      { label: 'runs prints the roster', argv: ['runs'], flavor: 'totals: 1 runs' },
      { label: 'analyze prints the corpus report', argv: ['analyze'], flavor: '## corpus' },
      { label: 'status prints the folded full-state summary', argv: ['status', runId], flavor: 'halted: final' },
      { label: 'report prints the run report', argv: ['report', runId], flavor: `run: ${runId}` },
    ]
    await assertEach(rows, async (row) => {
      const out = await cliMain(row.argv, { env: INVALID_ENV, deps })
      expect(out).toContain(row.flavor)
    })

    // serve reaches its own argument parsing — the MCP gate never ran
    await expect(cliMain(['serve', '--por', '1'], { env: INVALID_ENV, deps })).rejects.toThrow(
      /usage: afk-runner serve/u,
    )
  })

  it('a bare model beside the credential pair proceeds, warning on the ignored keys and never their values', async () => {
    const pipeline = makeFakePipeline()
    const taskFile = path.join(pipeline.repoRoot, 'task.md')
    fs.writeFileSync(taskFile, TASK_TEXT)
    const stderrLines: string[] = []
    const original = console.error
    console.error = (line: string): void => {
      stderrLines.push(line)
    }
    try {
      const summary = await cliMain(['start', taskFile], {
        env: {
          AGENT_MCP_SERVERS: VALID_ENV['AGENT_MCP_SERVERS'],
          LLM_API_KEY: 'sk-warn-4b7e91',
          LLM_BASE_URL: 'https://llm-warn.example.test/v1',
        },
        deps: pipeline.deps,
      })
      expect(summary).toContain('halted: final')
    } finally {
      console.error = original
    }
    const warnings = stderrLines.join('\n')
    expect(warnings).toContain('LLM_API_KEY')
    expect(warnings).toContain('LLM_BASE_URL')
    expect(warnings).not.toContain('sk-warn-4b7e91')
    expect(warnings).not.toContain('llm-warn.example.test')
  })

  it('a valid surface on start reaches the spawned child env end to end (hermetic spawn seam)', async () => {
    const pipeline = makeFakePipeline()
    const taskFile = path.join(pipeline.repoRoot, 'task.md')
    fs.writeFileSync(taskFile, TASK_TEXT)
    const childEnvByBasename: Record<string, Record<string, string>> = {}
    const deps: RunDeps = { ...pipeline.deps, spawn: envCapturingSpawn(pipeline.deps.spawn, childEnvByBasename) }

    const summary = await cliMain(['start', taskFile], { env: VALID_ENV, deps })

    expect(summary).toContain('halted: final')
    // every stage spawn carried a composed replacement env, carriers stripped
    expect(Object.keys(childEnvByBasename)).toHaveLength(pipeline.spawnOrder.length)
    for (const childEnv of Object.values(childEnvByBasename)) {
      expect(childEnv['OPENCODE_CONFIG_CONTENT']).toBeTypeOf('string')
      for (const carrier of ['AGENT_MCP_SERVERS', 'AGENT_MCP_ROLE_NARROWING', 'LLM_API_KEY', 'LLM_BASE_URL']) {
        expect(Object.hasOwn(childEnv, carrier)).toBe(false)
      }
    }
    // the reviewer spawn's content is the narrowed composition; the estimator's carries the full base
    const surface = resolveAgentMcp(VALID_ENV, 'test-model')
    assert(surface !== undefined)
    expect(childEnvByBasename['findings-1.json']?.['OPENCODE_CONFIG_CONTENT']).toBe(
      composeConfigContent('test-model', surface, mcpFor(surface, 'reviewer')),
    )
    expect(childEnvByBasename['depth.json']?.['OPENCODE_CONFIG_CONTENT']).toBe(
      composeConfigContent('test-model', surface, mcpFor(surface, 'estimator')),
    )
  })
})
