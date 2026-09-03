// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

import { afterEach, describe, expect, it } from 'bun:test'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'

import type { WorkIO } from '../../../afk-runner/src/drive/loop.js'
import type { SddEvent } from '../../../afk-runner/src/events.js'
import { readEvents, stampEvent } from '../../../afk-runner/src/events.js'
import { workForOf } from '../../../afk-runner/src/graph/pipeline-work.js'
import type { KernelContext } from '../../../afk-runner/src/kernel/machine.js'
import { initialKernelContext } from '../../../afk-runner/src/kernel/machine.js'
import { resumeRun } from '../../../afk-runner/src/run-resume.js'
import { startRun } from '../../../afk-runner/src/run.js'
import type { RunCheckFn } from '../../../afk-runner/src/work/run-check.js'
import {
  VERIFY_CHECKS,
  newestVerifyVerdict,
  runVerifyWork,
  verifyOutcomeLines,
  verifyOutcomeOf,
} from '../../../afk-runner/src/work/verify.js'
import { assertEach, type Row } from '../../utils/grouped-assertions.js'
import type { FakePipeline } from '../fixtures/fake-pipeline.js'
import { TASK_TEXT, makeFakePipeline } from '../fixtures/fake-pipeline.js'

const tmpDirs: string[] = []

afterEach(() => {
  while (tmpDirs.length > 0) {
    const dir = tmpDirs.pop()
    if (dir !== undefined) fs.rmSync(dir, { recursive: true, force: true })
  }
})

/** A direct-seam harness: scripted runCheck results, a recording io, a temp run dir. */
function unitHarness(options: {
  readonly exitCodes?: readonly number[]
  readonly stdouts?: readonly string[]
  readonly runFiles?: Record<string, string>
}): {
  readonly runDir: string
  readonly runCheck: RunCheckFn
  readonly checkCalls: readonly string[][]
  readonly io: WorkIO
} {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'sdd-verify-unit-'))
  tmpDirs.push(dir)
  const runDir = path.join(dir, 'runs', 'r1')
  fs.mkdirSync(runDir, { recursive: true })
  for (const [name, body] of Object.entries(options.runFiles ?? {})) {
    fs.writeFileSync(path.join(runDir, name), body)
  }
  const exitCodes = [...(options.exitCodes ?? [])]
  const stdouts = [...(options.stdouts ?? [])]
  const checkCalls: string[][] = []
  const runCheck: RunCheckFn = (_cwd, command) => {
    checkCalls.push([...command])
    return Promise.resolve({ exitCode: exitCodes.shift() ?? 0, stdout: stdouts.shift() ?? '', stderr: '' })
  }
  const appended: SddEvent[] = []
  const io: WorkIO = {
    append: (event) => {
      const stamped = stampEvent(event, appended.length + 1, '2026-09-03T00:00:00.000Z')
      appended.push(stamped)
      return stamped
    },
    context: initialKernelContext({}),
    runDir,
  }
  return { runDir, runCheck, checkCalls, io }
}

describe('VERIFY_CHECKS — the compiled gate set (U3 D5)', () => {
  it('pins the three repo gates as command arrays', () => {
    expect(VERIFY_CHECKS).toEqual([
      ['bun', 'run', 'typecheck'],
      ['bun', 'run', 'lint'],
      ['bun', 'run', 'test', '--', '--serial'],
    ])
  })
})

describe('verifyOutcomeLines — the per-log verdict listing (U3 D9 report seam)', () => {
  it('lists every verify log version-ordered with its verdict, unknown when the line is absent', () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'sdd-verify-lines-'))
    tmpDirs.push(dir)
    fs.writeFileSync(path.join(dir, 'verify-2.log'), 'output\nverdict: green\n')
    fs.writeFileSync(path.join(dir, 'verify-1.log'), 'output\nverdict: red\n')
    fs.writeFileSync(path.join(dir, 'verify-3.log'), 'no verdict line\n')
    expect(verifyOutcomeLines(dir)).toEqual([
      { log: 'verify-1', verdict: 'red' },
      { log: 'verify-2', verdict: 'green' },
      { log: 'verify-3', verdict: 'unknown' },
    ])
  })

  it('an absent run dir lists nothing', () => {
    expect(verifyOutcomeLines(path.join(os.tmpdir(), 'sdd-verify-absent-'))).toEqual([])
  })
})

describe('runVerifyWork — the boundary run (U3 D5)', () => {
  it('green: runs every check once, writes verify-1.log with outputs and verdict green, appends no events', async () => {
    const h = unitHarness({ stdouts: ['types ok', 'lint ok', 'tests ok'] })
    await runVerifyWork({ runCheck: h.runCheck, runDir: h.runDir, cwd: '/repo' }, h.io)
    expect(h.checkCalls).toEqual(VERIFY_CHECKS.map((command) => [...command]))
    const log = fs.readFileSync(path.join(h.runDir, 'verify-1.log'), 'utf8')
    expect(log).toContain('$ bun run typecheck')
    expect(log).toContain('types ok')
    expect(log).toContain('exit 0')
    expect(log.endsWith('verdict: green\n')).toBe(true)
  })

  it('red: a failing check records its output and verdict red, throws nothing, appends no events', async () => {
    const h = unitHarness({ exitCodes: [0, 1], stdouts: ['', 'src/broken.ts:5:11 lint failure\n'] })
    await runVerifyWork({ runCheck: h.runCheck, runDir: h.runDir, cwd: '/repo' }, h.io)
    const log = fs.readFileSync(path.join(h.runDir, 'verify-1.log'), 'utf8')
    expect(log).toContain('exit 1')
    expect(log).toContain('src/broken.ts:5:11 lint failure')
    expect(log.endsWith('verdict: red\n')).toBe(true)
  })

  it('versioning: an existing verify-2.log advances the next write to verify-3.log', async () => {
    const h = unitHarness({ runFiles: { 'verify-2.log': 'verdict: red\n' } })
    await runVerifyWork({ runCheck: h.runCheck, runDir: h.runDir, cwd: '/repo' }, h.io)
    expect(fs.existsSync(path.join(h.runDir, 'verify-3.log'))).toBe(true)
    expect(newestVerifyVerdict(h.runDir)).toBe('green')
  })
})

describe('verifyOutcomeOf — the pure outcome reader (U3 D5)', () => {
  interface CaseFields {
    readonly stage: 'pending' | 'active' | 'done'
    readonly verdict: 'green' | 'red' | null
    readonly expected: 'unverified' | 'green' | 'red'
  }

  type CaseRow = Row<CaseFields>

  const rows: readonly CaseRow[] = [
    {
      label: 'fresh entry (pending, no log) owes the boundary',
      stage: 'pending',
      verdict: null,
      expected: 'unverified',
    },
    {
      label: 'an active bracket owes the boundary even with a stale red log (re-run dominance)',
      stage: 'active',
      verdict: 'red',
      expected: 'unverified',
    },
    { label: 'done + green log releases', stage: 'done', verdict: 'green', expected: 'green' },
    { label: 'done + red log routes back into implement', stage: 'done', verdict: 'red', expected: 'red' },
    {
      label: 'done with no log artifact re-owns the boundary (crash rewind)',
      stage: 'done',
      verdict: null,
      expected: 'unverified',
    },
  ]

  it('outcome matrix', async () => {
    await assertEach(rows, (row) => {
      const context: KernelContext = {
        ...initialKernelContext({ verify: row.stage }),
      }
      expect(verifyOutcomeOf(context, row.verdict)).toBe(row.expected)
    })
  })
})

describe('the verify registry entry (U3 D5)', () => {
  it('workForOf maps the verify state to the boundary work and the three outcomes', () => {
    const pipeline = makeFakePipeline()
    const module = workForOf(
      pipeline.deps,
      { taskText: TASK_TEXT, changeName: 'add-thing' },
      path.join(pipeline.deps.config.workDir, 'runs', 'probe'),
    )('verify')
    expect(module).not.toBeNull()
    expect(module?.work?.kind).toBe('verify')
    expect(module?.successors).toEqual({
      unverified: { enter: 'verify' },
      green: { enter: 'release' },
      red: { enter: 'implement' },
    })
  })
})

interface WalkHalt {
  readonly pipeline: FakePipeline
  readonly runId: string
  readonly runDir: string
  readonly logPath: string
  readonly halted: { readonly halted: string; readonly position: string }
}

function fakeClock(): { readonly tick: () => Promise<void>; readonly release: () => void } {
  const queue: Array<() => void> = []
  return {
    tick: () =>
      new Promise<void>((resolve) => {
        queue.push(resolve)
      }),
    release: (): void => {
      const resolve = queue.shift()
      if (resolve !== undefined) resolve()
    },
  }
}

/** Release ticks until the resumed run halts (wall-clock bounded — a fixed tick count races the settle chain's fs reads). */

const TASKS_MD = ['## 1. Walk', '', '- [ ] 1.1 first item', '- [ ] 1.2 second item', '- [ ] 1.3 third item', ''].join(
  '\n',
)

/** Start an armed run, park at the final gate, approve through the operator file, let the walk run. */
/** The prompts one spawn basename recorded — empty when it never spawned. */
function promptsOf(pipeline: FakePipeline, basename: string): readonly string[] {
  return pipeline.spawnPrompts[basename] ?? []
}

async function approvedIntoImplement(
  checkExitCodes: readonly number[],
  checkStdouts: readonly string[],
  capture: { releaseMd: string } = { releaseMd: '' },
): Promise<WalkHalt> {
  const pipeline = makeFakePipeline({
    artifactOverrides: { 'decompose-tasks.json': TASKS_MD },
    sidecarOverrides: {
      'implement-t1.json': JSON.stringify({ files_written: ['src/one.ts'] }),
      'implement-t2.json': JSON.stringify({ files_written: ['src/two.ts'] }),
      'implement-t3.json': JSON.stringify({ files_written: ['src/three.ts'] }),
    },
    checkExitCodes,
    checkStdouts,
  })
  const started = await startRun(pipeline.deps, { taskText: TASK_TEXT, execute: true })
  expect(started.halted).toBe('gate-pending')
  const runDir = pipeline.runDirOf(started.runId)
  fs.writeFileSync(
    path.join(runDir, 'gate-1.md'),
    '<!-- gate-1.md -->\n\n## Final gate\n\n## Gate response\n\nAPPROVE\n',
  )
  const clock = fakeClock()
  const halted = await abortReleaseAndWait(
    resumeRun({ ...pipeline.deps, gateWait: { tick: clock.tick } }, started.runId),
    clock,
    runDir,
    capture,
  )
  return { pipeline, runId: started.runId, runDir, logPath: path.join(runDir, 'events.ndjson'), halted }
}

/** Tick until the resumed run halts; once the release presentation lands, capture its content and settle ABORT so the waiter exits. */
async function abortReleaseAndWait<T>(
  pending: Promise<T>,
  clock: { readonly release: () => void },
  runDir: string,
  capture: { releaseMd: string } = { releaseMd: '' },
  budgetMs = 10_000,
): Promise<T> {
  const state = { settled: false }
  const tracked = pending.then(
    (value: T): T => {
      state.settled = true
      return value
    },
    (error: unknown): never => {
      state.settled = true
      throw error
    },
  )
  let aborted = false
  const deadline = Date.now() + budgetMs
  while (Date.now() < deadline && !state.settled) {
    clock.release()
    await new Promise((resolve) => {
      setTimeout(resolve, 2)
    })
    if (!aborted && fs.existsSync(path.join(runDir, 'gate-2.md'))) {
      capture.releaseMd = fs.readFileSync(path.join(runDir, 'gate-2.md'), 'utf8')
      fs.writeFileSync(path.join(runDir, 'gate-2.md'), '<!-- gate-2.md -->\n\n## Gate response\n\nABORT\n')
      aborted = true
    }
  }
  return tracked
}

/** The stage entries of one stage in a log — the boundary's re-entry count. */
function stageEntersOf(
  events: readonly { readonly type: string; readonly stage?: string }[],
  stage: string,
): readonly unknown[] {
  return events.filter((event) => event.type === 'stage_enter' && event.stage === stage)
}

/** The newest prompt a spawn basename recorded — empty when it never spawned. */
function lastPromptOf(pipeline: FakePipeline, basename: string): string {
  return promptsOf(pipeline, basename).at(-1) ?? ''
}

describe('the verify boundary on the walk (U3 D5)', () => {
  it('green boundary: all tasks done → verify runs the gate set → release presents (settled ABORT here)', async () => {
    const capture = { releaseMd: '' }
    const h = await approvedIntoImplement([0, 0, 0, 0, 0, 0], [], capture)
    const verifyCalls = h.pipeline.checkCalls.filter((command) => command.join(' ') !== 'bun run test:affected')
    expect(verifyCalls).toEqual(VERIFY_CHECKS.map((command) => [...command]))
    const log = fs.readFileSync(path.join(h.runDir, 'verify-1.log'), 'utf8')
    expect(log.endsWith('verdict: green\n')).toBe(true)
    expect(capture.releaseMd).toContain('## Release gate — change add-thing')
    expect(capture.releaseMd).toContain('verify-1: green')
    expect(h.halted.halted).toBe('final')
    expect(h.halted.position).toBe('aborted')
  })

  it('red boundary: verify red routes back into implement as fix context — no stage_failed, no escalation', async () => {
    const h = await approvedIntoImplement(
      [0, 0, 0, 0, 1, 0, 0, 0, 0, 0],
      ['', '', '', '', 'src/old.ts:31:7 expects two to be three\n'],
    )
    const events = readEvents(h.logPath)
    expect(events.filter((event) => event.type === 'stage_failed')).toEqual([])
    const enters = stageEntersOf(events, 'verify')
    expect(enters).toHaveLength(2)
    const log = fs.readFileSync(path.join(h.runDir, 'verify-1.log'), 'utf8')
    expect(log).toContain('src/old.ts:31:7')
    const fixSpawn = h.pipeline.spawnOrder.filter((basename) => basename.startsWith('implement-t')).length
    expect(fixSpawn).toBe(4)
    const fixPrompt = lastPromptOf(h.pipeline, 'implement-t3.json')
    expect(fixPrompt).toContain('src/old.ts:31:7')
    // the fix answers the red log in the artifact itself — the last line is
    // no longer the verdict, so the outcome reader no longer owes a fix
    expect(log.endsWith('verdict: red\n')).toBe(false)
    expect(log.trimEnd().endsWith('fix answered: task 3')).toBe(true)
    const fixed = fs.readFileSync(path.join(h.runDir, 'verify-2.log'), 'utf8')
    expect(fixed.endsWith('verdict: green\n')).toBe(true)
    expect(h.halted.halted).toBe('final')
  })
})
