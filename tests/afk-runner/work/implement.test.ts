// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

import { afterEach, describe, expect, it } from 'bun:test'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'

import { agentWritePath } from '../../../afk-runner/src/agent-backend/agent-runner.js'
import type { AgentLayerDeps } from '../../../afk-runner/src/agent-layer.js'
import type { RunnerConfig } from '../../../afk-runner/src/config.js'
import type { WorkIO } from '../../../afk-runner/src/drive/loop.js'
import { StageHaltError } from '../../../afk-runner/src/errors.js'
import type { SddEvent } from '../../../afk-runner/src/events.js'
import { readEvents, stampEvent } from '../../../afk-runner/src/events.js'
import { workForOf } from '../../../afk-runner/src/graph/pipeline-work.js'
import { pipelineMachine } from '../../../afk-runner/src/graph/pipeline.js'
import { foldEvents } from '../../../afk-runner/src/kernel/fold.js'
import { initialKernelContext } from '../../../afk-runner/src/kernel/machine.js'
import type { KernelContext } from '../../../afk-runner/src/kernel/machine.js'
import { resumeRun } from '../../../afk-runner/src/run-resume.js'
import { startRun } from '../../../afk-runner/src/run.js'
import type { ImplementDeps } from '../../../afk-runner/src/work/implement.js'
import {
  firstOwedItem,
  implementOutcomeOf,
  runImplementWork,
  taskStartedDetail,
} from '../../../afk-runner/src/work/implement.js'
import { parseTaskItems } from '../../../afk-runner/src/work/tasks-md.js'
import type { TaskItem } from '../../../afk-runner/src/work/tasks-md.js'
import type { FakePipeline } from '../fixtures/fake-pipeline.js'
import { TASK_TEXT, makeFakePipeline } from '../fixtures/fake-pipeline.js'
import { assertEach, type Row } from '../grouped-assertions.js'

const tmpDirs: string[] = []

afterEach(() => {
  while (tmpDirs.length > 0) {
    const dir = tmpDirs.pop()
    if (dir !== undefined) fs.rmSync(dir, { recursive: true, force: true })
  }
})

const TASKS_MD = ['## 1. Walk', '', '- [ ] 1.1 first item', '- [ ] 1.2 second item', '- [ ] 1.3 third item', ''].join(
  '\n',
)

function makeArmedPipeline(options: { readonly checkExitCodes?: readonly number[] } = {}): FakePipeline {
  return makeFakePipeline({
    artifactOverrides: { 'decompose-tasks.json': TASKS_MD },
    sidecarOverrides: {
      'implement-t1.json': JSON.stringify({ files_written: ['src/one.ts'] }),
      'implement-t2.json': JSON.stringify({ files_written: ['src/two.ts'] }),
      'implement-t3.json': JSON.stringify({ files_written: ['src/three.ts'] }),
    },
    ...(options.checkExitCodes === undefined ? {} : { checkExitCodes: options.checkExitCodes }),
  })
}

interface WalkHalt {
  readonly pipeline: FakePipeline
  readonly runId: string
  readonly runDir: string
  readonly logPath: string
  readonly halted: { readonly halted: string; readonly position: string }
}

/** Start an armed run, park at the final gate, approve through the operator file, let the walk run; the release gate settles ABORT (its arms are 6.3). */
async function approvedIntoImplement(): Promise<WalkHalt> {
  const pipeline = makeArmedPipeline()
  const started = await startRun(pipeline.deps, {
    taskText: TASK_TEXT,
    execute: true,
  })
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
  )
  return {
    pipeline,
    runId: started.runId,
    runDir,
    logPath: path.join(runDir, 'events.ndjson'),
    halted,
  }
}

/** Tick until the resumed run halts; once the release presentation lands, settle it ABORT so the waiter exits. */
async function abortReleaseAndWait<T>(
  pending: Promise<T>,
  clock: { readonly release: () => void },
  runDir: string,
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
      fs.writeFileSync(path.join(runDir, 'gate-2.md'), '<!-- gate-2.md -->\n\n## Gate response\n\nABORT\n')
      aborted = true
    }
  }
  return tracked
}

function taskTokens(events: readonly SddEvent[]): string[] {
  return events
    .filter((event): event is Extract<SddEvent, { type: 'task' }> => event.type === 'task')
    .map((event) => `${event.action}:${event.id}`)
}

function stageTokens(events: readonly SddEvent[]): string[] {
  return events
    .filter((event) => event.type === 'stage_enter' || event.type === 'stage_exit')
    .map((event) => `${event.type}:${event.stage}`)
}

/** The first prompt a spawn seam recorded for a basename — empty when it never spawned. */
function firstPromptOf(pipeline: FakePipeline, basename: string): string {
  return pipeline.spawnPrompts[basename]?.[0] ?? ''
}

/** Every prompt recorded for the given basenames, flattened in order. */
function promptsOf(pipeline: FakePipeline, ...basenames: string[]): string[] {
  return basenames.flatMap((basename) => pipeline.spawnPrompts[basename] ?? [])
}

/** The log index of a task's done record — -1 when the walk never recorded it. */
function taskDoneAt(events: readonly SddEvent[], id: string): number {
  return events.findIndex((event) => event.type === 'task' && event.action === 'done' && event.id === id)
}

/** The picked item's id as a plain string — null when nothing is owed. */
function pickedIdOf(items: readonly TaskItem[], tasks: KernelContext['tasks']): string | null {
  return firstOwedItem(items, tasks)?.id ?? null
}

describe('implement work module — the sequential task walk (U3 D4)', () => {
  it('walks items in file order: one implementer spawn per item, started/done pairs, self-re-entry until all done', async () => {
    const h = await approvedIntoImplement()
    expect(h.pipeline.spawnOrder.filter((basename) => basename.startsWith('implement-t'))).toEqual([
      'implement-t1.json',
      'implement-t2.json',
      'implement-t3.json',
    ])
    const events = readEvents(h.logPath)
    expect(taskTokens(events)).toEqual(['started:1', 'done:1', 'started:2', 'done:2', 'started:3', 'done:3'])
    // the armed-approve mover's entry plus one re-entry per walked item
    expect(stageTokens(events).filter((token) => token === 'stage_enter:implement')).toHaveLength(4)
    // the walk hands off to verify — its boundary runs green, release
    // presents (the 6.2 module), and the test settles ABORT so the run ends
    expect(stageTokens(events)).toContain('stage_enter:verify')
    expect(h.halted.halted).toBe('final')
    expect(h.halted.position).toBe('aborted')
  })

  it('the spawn prompt carries the item text and the report path the affected check reads', async () => {
    const h = await approvedIntoImplement()
    const prompt = firstPromptOf(h.pipeline, 'implement-t2.json')
    expect(prompt).toContain('second item')
    expect(prompt).toContain('implement-t2.json')
    expect(prompt).toContain('add-thing')
  })

  it('a red affected check once then green: the item fails, re-picks under the bound, commits on the pass', async () => {
    const pipeline = makeArmedPipeline({ checkExitCodes: [1] })
    const started = await startRun(pipeline.deps, {
      taskText: TASK_TEXT,
      execute: true,
    })
    expect(started.halted).toBe('gate-pending')
    const runDir = pipeline.runDirOf(started.runId)
    fs.writeFileSync(
      path.join(runDir, 'gate-1.md'),
      '<!-- gate-1.md -->\n\n## Final gate\n\n## Gate response\n\nAPPROVE\n',
    )
    const clock = fakeClock()
    await abortReleaseAndWait(
      resumeRun({ ...pipeline.deps, gateWait: { tick: clock.tick } }, started.runId),
      clock,
      runDir,
    )
    const events = readEvents(path.join(runDir, 'events.ndjson'))
    expect(taskTokens(events)).toEqual([
      'started:1',
      'failed:1',
      'started:1',
      'done:1',
      'started:2',
      'done:2',
      'started:3',
      'done:3',
    ])
    expect(pipeline.checkCalls.filter((command) => command.join(' ') === 'bun run test:affected')).toHaveLength(4)
  })

  it('outcomeOf maps all-done→verify; a file-ahead crash window advances rather than re-walking', async () => {
    const h = await approvedIntoImplement()
    const module = workForOf(h.pipeline.deps, { taskText: TASK_TEXT, changeName: 'add-thing' }, h.runDir)('implement')
    expect(module).not.toBeNull()
    expect(module?.successors).toEqual({
      outstanding: { enter: 'implement' },
      done: { enter: 'verify' },
    })
    const events = readEvents(h.logPath)
    const allDone = foldEvents(pipelineMachine, events).snapshot.context
    expect(module?.outcomeOf(allDone)).toBe('done')
    const firstDoneAt = taskDoneAt(events, '1')
    expect(firstDoneAt).toBeGreaterThan(-1)
    const midWalk = foldEvents(pipelineMachine, events.slice(0, firstDoneAt + 1)).snapshot.context
    // the walk committed ahead of this log prefix (crash between the slice
    // commit and the done event): the tree's claim advances the walk
    expect(module?.outcomeOf(midWalk)).toBe('done')
    // with the file restored to the same mid-walk state, items 2–3 stay owed
    fs.writeFileSync(
      path.join(h.pipeline.changeDir, 'tasks.md'),
      ['## 1. Walk', '', '- [x] 1.1 first item', '- [ ] 1.2 second item', '- [ ] 1.3 third item', ''].join('\n'),
    )
    expect(module?.outcomeOf(midWalk)).toBe('outstanding')
  })
})

describe('firstOwedItem / implementOutcomeOf — the pick and outcome rules (D4)', () => {
  const items = parseTaskItems('- [ ] 1.1 first item\n- [x] 1.2 second item\n- [ ] 1.3 third item\n')

  interface CaseFields {
    readonly tasks: Readonly<
      Record<
        string,
        {
          readonly status: 'running' | 'done' | 'failed'
          readonly attempts: number
        }
      >
    >
    readonly picked: string | null
    readonly outcome: 'outstanding' | 'done'
    readonly redOwed?: boolean
  }

  type CaseRow = Row<CaseFields>

  const rows: readonly CaseRow[] = [
    {
      label: 'fresh residue picks the first unchecked item',
      tasks: {},
      picked: '1',
      outcome: 'outstanding',
    },
    {
      label: 'a folded done record skips an unchecked item; checked items never pick',
      tasks: { '1': { status: 'done', attempts: 1 } },
      picked: '3',
      outcome: 'outstanding',
    },
    {
      label: 'a running item (killed mid-spawn) stays owed and re-picks',
      tasks: { '1': { status: 'running', attempts: 1 } },
      picked: '1',
      outcome: 'outstanding',
    },
    {
      label: 'every item recorded done maps onward to verify',
      tasks: {
        '1': { status: 'done', attempts: 1 },
        '3': { status: 'done', attempts: 1 },
      },
      picked: null,
      outcome: 'done',
    },
    {
      label: 'every item done but an unanswered red verdict owes the fix (D4/D5)',
      tasks: {
        '1': { status: 'done', attempts: 1 },
        '2': { status: 'done', attempts: 1 },
        '3': { status: 'done', attempts: 1 },
      },
      picked: null,
      outcome: 'outstanding',
      redOwed: true,
    },
  ]

  it('pick/outcome matrix', async () => {
    await assertEach(rows, (row) => {
      const redOwed = row.redOwed === true
      const context = { ...initialKernelContext({}), tasks: row.tasks }
      expect(pickedIdOf(items, context.tasks)).toBe(row.picked)
      expect(implementOutcomeOf(context, items, redOwed)).toBe(row.outcome)
    })
  })
})

/** A direct-seam harness: tasks.md on disk, a residue-shaped context, scripted execGit, recording spawn. */
function unitHarness(options: {
  readonly tasksMd?: string
  readonly tasks: KernelContext['tasks']
  readonly runFiles?: Record<string, string>
  readonly gitLogStdout?: string
  readonly checkExitCodes?: readonly number[]
  readonly porcelain?: readonly string[]
}): {
  readonly deps: ImplementDeps
  readonly io: WorkIO
  readonly appended: SddEvent[]
  readonly spawnBasenames: string[]
  readonly prompts: string[]
  readonly gitCalls: string[][]
  readonly checkCalls: readonly string[][]
  readonly tasksMdPath: string
} {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'sdd-impl-unit-'))
  tmpDirs.push(dir)
  const changeDir = path.join(dir, 'openspec', 'changes', 'add-thing')
  fs.mkdirSync(changeDir, { recursive: true })
  const tasksMdPath = path.join(changeDir, 'tasks.md')
  fs.writeFileSync(tasksMdPath, options.tasksMd ?? TASKS_MD)
  const runDir = path.join(dir, 'runs', 'r1')
  for (const [name, body] of Object.entries(options.runFiles ?? {})) {
    fs.mkdirSync(path.dirname(path.join(runDir, name)), { recursive: true })
    fs.writeFileSync(path.join(runDir, name), body)
  }
  const appended: SddEvent[] = []
  const spawnBasenames: string[] = []
  const prompts: string[] = []
  const gitCalls: string[][] = []
  const checkCalls: string[][] = []
  const checkExitCodes = [...(options.checkExitCodes ?? [])]
  const porcelainOutputs = [...(options.porcelain ?? [''])]
  let statusCalls = 0
  const config: RunnerConfig = {
    repoRoot: dir,
    workDir: path.join(dir, '.sdd-runner'),
    model: 'm',
    budget: 5,
  }
  const agent: AgentLayerDeps = {
    spawn: (_command, args, spawnOptions) => {
      const prompt = String(args[args.length - 1])
      prompts.push(prompt)
      const basename = prompt.match(/\.review-loop\/([\w-]+\.json)/u)?.[1] ?? 'unknown.json'
      spawnBasenames.push(basename)
      const target = agentWritePath(spawnOptions.cwd, basename)
      fs.mkdirSync(path.dirname(target), { recursive: true })
      fs.writeFileSync(target, JSON.stringify({ files_written: ['src/one.ts'] }))
      return Promise.resolve({ exitCode: 0, stdout: '', stderr: '' })
    },
    config,
    execGit: (_cwd, args) => {
      gitCalls.push([...args])
      if (args.includes('log'))
        return Promise.resolve({
          stdout: options.gitLogStdout ?? '',
          stderr: '',
        })
      if (args[0] === 'status') {
        const stdout = porcelainOutputs[Math.min(statusCalls, porcelainOutputs.length - 1)] ?? ''
        statusCalls += 1
        return Promise.resolve({ stdout, stderr: '' })
      }
      return Promise.resolve({ stdout: '', stderr: '' })
    },
    emit: () => undefined,
  }
  const io: WorkIO = {
    append: (event) => {
      const stamped = stampEvent(event, appended.length + 1, '2026-09-03T00:00:00.000Z')
      appended.push(stamped)
      return stamped
    },
    context: { ...initialKernelContext({}), tasks: options.tasks },
    runDir,
  }
  const deps: ImplementDeps = {
    agent,
    runDir,
    sidecarDir: path.join(runDir, 'sidecars'),
    cwd: dir,
    runCheck: (_cwd, command) => {
      checkCalls.push([...command])
      return Promise.resolve({
        exitCode: checkExitCodes.shift() ?? 0,
        stdout: '',
        stderr: '',
      })
    },
  }
  return {
    deps,
    io,
    appended,
    spawnBasenames,
    prompts,
    gitCalls,
    checkCalls,
    tasksMdPath,
  }
}

const ALL_DONE: KernelContext['tasks'] = {
  '1': { status: 'done', attempts: 1 },
  '2': { status: 'done', attempts: 1 },
  '3': { status: 'done', attempts: 1 },
}

describe('attempt bound, resume skip-forward, and fix-mode re-target (D4)', () => {
  it('a third started for one id is refused as declared exhaustion before any spawn or event', async () => {
    const h = unitHarness({
      tasks: { '1': { status: 'running', attempts: 2 } },
    })
    expect(h.io.context.tasks['1']).toMatchObject({ attempts: 2 })
    await expect(runImplementWork(h.deps, { changeName: 'add-thing' }, h.io)).rejects.toBeInstanceOf(StageHaltError)
    expect(h.spawnBasenames).toEqual([])
    expect(h.appended).toEqual([])
  })

  it('resume skip-forward: a log truncated after two done records spawns only the remaining item', async () => {
    const h = await approvedIntoImplement()
    const walkedBefore = h.pipeline.spawnOrder.filter((basename) => basename.startsWith('implement-t')).length
    expect(walkedBefore).toBe(3)
    const events = readEvents(h.logPath)
    const cut = taskDoneAt(events, '2')
    expect(cut).toBeGreaterThan(-1)
    const keptCount = cut + 1
    fs.writeFileSync(h.logPath, '')
    for (const event of events.slice(0, keptCount)) {
      fs.appendFileSync(h.logPath, `${JSON.stringify(event)}\n`)
    }
    // the true crash shape rewinds the tree with the log: boxes 1–2 committed
    // checked, item 3 still owed
    fs.writeFileSync(
      path.join(h.pipeline.changeDir, 'tasks.md'),
      ['## 1. Walk', '', '- [x] 1.1 first item', '- [x] 1.2 second item', '- [ ] 1.3 third item', ''].join('\n'),
    )
    const resumed = await resumeRun(h.pipeline.deps, h.runId)
    expect(resumed.drove).toBe(true)
    const after = h.pipeline.spawnOrder.filter((basename) => basename.startsWith('implement-t'))
    expect(after.slice(walkedBefore)).toEqual(['implement-t3.json'])
    const resumedEvents = readEvents(h.logPath).slice(keptCount)
    expect(taskTokens(resumedEvents)).toEqual(['started:3', 'done:3'])
  })

  it('fix mode re-targets the culprit whose slice commit last touched a failing path', async () => {
    const h = unitHarness({
      tasks: ALL_DONE,
      runFiles: {
        'verify-1.log': ['(fail) expects two to be three', 'src/old.ts:31:7'].join('\n'),
      },
      gitLogStdout: [
        '@@1.3 third item',
        'src/three.ts',
        '@@1.2 second item',
        'src/two.ts',
        'src/old.ts',
        '@@1.1 first item',
        'src/one.ts',
      ].join('\n'),
    })
    await runImplementWork(h.deps, { changeName: 'add-thing' }, h.io)
    expect(h.spawnBasenames).toEqual(['implement-t2.json'])
    expect(taskTokens(h.appended)).toEqual(['started:2', 'done:2'])
    expect(h.prompts[0]).toContain('src/old.ts:31:7')
    const answeredLog = fs.readFileSync(path.join(h.deps.runDir, 'verify-1.log'), 'utf8')
    expect(answeredLog.trimEnd().endsWith('fix answered: task 2')).toBe(true)
  })

  it('fix mode picks the latest slice commit when several touch the failing path', async () => {
    const h = unitHarness({
      tasks: ALL_DONE,
      runFiles: {
        'verify-1.log': ['(fail) expects two to be three', 'src/shared.ts:3:1'].join('\n'),
      },
      gitLogStdout: [
        '@@1.3 third item',
        'src/shared.ts',
        '@@1.2 second item',
        'src/shared.ts',
        '@@1.1 first item',
        'src/one.ts',
      ].join('\n'),
    })
    await runImplementWork(h.deps, { changeName: 'add-thing' }, h.io)
    expect(h.spawnBasenames).toEqual(['implement-t3.json'])
  })

  it('fix mode falls back to the last-walked id when no failing path maps to a slice commit', async () => {
    const h = unitHarness({
      tasks: ALL_DONE,
      runFiles: {
        'verify-1.log': ['(fail) expects two to be three', 'src/unmapped.ts:1:1'].join('\n'),
      },
      gitLogStdout: ['@@1.2 second item', 'src/two.ts', '@@1.1 first item', 'src/one.ts'].join('\n'),
    })
    await runImplementWork(h.deps, { changeName: 'add-thing' }, h.io)
    expect(h.spawnBasenames).toEqual(['implement-t3.json'])
    expect(taskTokens(h.appended)).toEqual(['started:3', 'done:3'])
  })

  it('fix mode re-targets the last-walked item from an unanswered release veto, answering the sidecar (D7)', async () => {
    const h = unitHarness({
      tasks: ALL_DONE,
      runFiles: {
        'release-veto.md': '<!-- release-veto.md -->\nVETO: tighten the error copy\n',
      },
    })
    await runImplementWork(h.deps, { changeName: 'add-thing' }, h.io)
    expect(h.spawnBasenames).toEqual(['implement-t3.json'])
    expect(h.prompts[0]).toContain('tighten the error copy')
    const sidecar = fs.readFileSync(path.join(h.deps.runDir, 'release-veto.md'), 'utf8')
    expect(sidecar.trimEnd().endsWith('fix answered: task 3')).toBe(true)
  })

  it('an answered release veto no longer owes a fix (D7)', async () => {
    const h = unitHarness({
      tasks: ALL_DONE,
      runFiles: {
        'release-veto.md': '<!-- release-veto.md -->\nVETO: tighten\nfix answered: task 3\n',
      },
    })
    await runImplementWork(h.deps, { changeName: 'add-thing' }, h.io)
    expect(h.spawnBasenames).toEqual([])
    expect(h.appended).toEqual([])
  })

  it('no fix context and all items done: the walk owes nothing further', async () => {
    const h = unitHarness({ tasks: ALL_DONE })
    await runImplementWork(h.deps, { changeName: 'add-thing' }, h.io)
    expect(h.spawnBasenames).toEqual([])
    expect(h.appended).toEqual([])
  })

  it('a green affected check commits the checked box with the work before the done event', async () => {
    const h = unitHarness({ tasks: {} })
    await runImplementWork(h.deps, { changeName: 'add-thing' }, h.io)
    expect(taskTokens(h.appended)).toEqual(['started:1', 'done:1'])
    expect(h.checkCalls).toEqual([['bun', 'run', 'test:affected']])
    expect(commitCalls(h.gitCalls)).toEqual([
      ['add', '-A'],
      ['commit', '--no-verify', '-m', '1.1 first item'],
    ])
    expect(fs.readFileSync(h.tasksMdPath, 'utf8')).toContain('- [x] 1.1 first item')
  })

  it('a red affected check records task failed, commits nothing, leaves the box unchecked', async () => {
    const h = unitHarness({ tasks: {}, checkExitCodes: [1] })
    await runImplementWork(h.deps, { changeName: 'add-thing' }, h.io)
    expect(taskTokens(h.appended)).toEqual(['started:1', 'failed:1'])
    expect(commitCalls(h.gitCalls)).toEqual([])
    expect(fs.readFileSync(h.tasksMdPath, 'utf8')).not.toContain('- [x] 1.1 first item')
  })
})

describe('write guard widening at the implementer seam (U3 D6)', () => {
  it('source-tree dirt passes the widened guard and the slice still commits', async () => {
    const h = unitHarness({ tasks: {}, porcelain: ['', ' M src/one.ts\n'] })
    await runImplementWork(h.deps, { changeName: 'add-thing' }, h.io)
    expect(taskTokens(h.appended)).toEqual(['started:1', 'done:1'])
    expect(commitCalls(h.gitCalls)).toEqual([
      ['add', '-A'],
      ['commit', '--no-verify', '-m', '1.1 first item'],
    ])
  })

  it('sibling change-folder dirt fails the seam naming the path and the protection, committing nothing', async () => {
    const h = unitHarness({
      tasks: {},
      porcelain: ['', '?? openspec/changes/other-change/x.md\n'],
    })
    await expect(runImplementWork(h.deps, { changeName: 'add-thing' }, h.io)).rejects.toThrow(
      'agent edited files in a protected change folder (writes under openspec/changes/ must stay within openspec/changes/add-thing/): openspec/changes/other-change/x.md',
    )
    expect(taskTokens(h.appended)).toEqual(['started:1'])
    expect(commitCalls(h.gitCalls)).toEqual([])
  })
})

describe('structural precondition halt — missing/unreadable tasks.md (walk-robustness F-P3)', () => {
  it('a missing tasks.md rejects as StageHaltError{precondition} with the restoration resume hint, before any spawn', async () => {
    const h = unitHarness({ tasks: {} })
    fs.rmSync(h.tasksMdPath)
    let caught: unknown
    try {
      await runImplementWork(h.deps, { changeName: 'add-thing' }, h.io)
    } catch (error) {
      caught = error
    }
    expect(caught).toBeInstanceOf(StageHaltError)
    expect(caught).toMatchObject({
      kind: 'precondition',
      resumeHint: 'resume after the change folder is restored',
    })
    expect(String(caught)).toContain('implement cannot read')
    expect(String(caught)).toContain(h.tasksMdPath)
    expect(h.spawnBasenames).toEqual([])
    expect(h.appended).toEqual([])
  })

  it('an unreadable tasks.md (EISDIR) rejects with the same precondition shape, not a plain Error', async () => {
    const h = unitHarness({ tasks: {} })
    fs.rmSync(h.tasksMdPath)
    fs.mkdirSync(h.tasksMdPath)
    let caught: unknown
    try {
      await runImplementWork(h.deps, { changeName: 'add-thing' }, h.io)
    } catch (error) {
      caught = error
    }
    expect(caught).toBeInstanceOf(StageHaltError)
    expect(caught).toMatchObject({
      kind: 'precondition',
      resumeHint: 'resume after the change folder is restored',
    })
    expect(String(caught)).toContain('implement cannot read')
  })
})

/** Only the slice-commit seam's git calls — the write guard's status snapshots are agent-layer mechanics. */
function commitCalls(gitCalls: readonly string[][]): string[][] {
  return gitCalls.filter((args) => args[0] === 'add' || args[0] === 'commit')
}

/** Every started task event's detail, in log order. */
function startedDetailsOf(events: readonly SddEvent[]): (string | undefined)[] {
  return events
    .filter(
      (event): event is Extract<SddEvent, { type: 'task' }> => event.type === 'task' && event.action === 'started',
    )
    .map((event) => event.detail)
}

describe('started-event detail and the todo-tool mandate (afk-runner-task-todos D1/D3)', () => {
  function startedDetailOf(appended: readonly SddEvent[], id: string): string | undefined {
    const started = appended.find(
      (event): event is Extract<SddEvent, { type: 'task' }> =>
        event.type === 'task' && event.action === 'started' && event.id === id,
    )
    return started?.detail
  }

  it('the started event carries the item text in detail, truncated at 200 chars', async () => {
    const h = unitHarness({
      tasksMd: [`- [ ] 1.1 ${'y'.repeat(450)}`, ''].join('\n'),
      tasks: {},
    })
    await runImplementWork(h.deps, { changeName: 'add-thing' }, h.io)
    expect(startedDetailOf(h.appended, '1')).toHaveLength(200)
    expect(startedDetailOf(h.appended, '1')).toBe(`1.1 ${'y'.repeat(196)}`)
  })

  it('a short item text rides the detail verbatim', async () => {
    const h = unitHarness({ tasks: {} })
    await runImplementWork(h.deps, { changeName: 'add-thing' }, h.io)
    expect(startedDetailOf(h.appended, '1')).toBe('1.1 first item')
  })

  it('taskStartedDetail collapses line breaks to one line before truncating at the bound', () => {
    expect(taskStartedDetail('fix the chunking fallback')).toBe('fix the chunking fallback')
    const multiline = `line one\nline two\r\nline three`
    expect(taskStartedDetail(multiline)).toBe(`line one line two line three`)
    expect(taskStartedDetail('z'.repeat(300))).toHaveLength(200)
    expect(taskStartedDetail('z'.repeat(300))).toBe('z'.repeat(200))
  })

  it('the fake pipeline walk stamps every item text: fresh, fix-shaped, and validation-retry prompts keep the mandate', async () => {
    const pipeline = makeFakePipeline({
      artifactOverrides: { 'decompose-tasks.json': TASKS_MD },
      sidecarOverrides: {
        'implement-t1.json': JSON.stringify({ files_written: ['src/one.ts'] }),
        'implement-t2.json': JSON.stringify({ files_written: ['src/two.ts'] }),
        'implement-t3.json': JSON.stringify({ files_written: ['src/three.ts'] }),
      },
      sidecarSequences: {
        // first implementer attempt writes an invalid sidecar, second passes:
        // the validation-retry rebuild of the base prompt must keep the line
        'implement-t1.json': ['{"files_written":[]}', JSON.stringify({ files_written: ['src/one.ts'] })],
      },
    })
    const started = await startRun(pipeline.deps, { taskText: TASK_TEXT, execute: true })
    expect(started.halted).toBe('gate-pending')
    const runDir = pipeline.runDirOf(started.runId)
    fs.writeFileSync(
      path.join(runDir, 'gate-1.md'),
      '<!-- gate-1.md -->\n\n## Final gate\n\n## Gate response\n\nAPPROVE\n',
    )
    const clock = fakeClock()
    await abortReleaseAndWait(
      resumeRun({ ...pipeline.deps, gateWait: { tick: clock.tick } }, started.runId),
      clock,
      runDir,
    )
    const events = readEvents(path.join(runDir, 'events.ndjson'))
    expect(startedDetailsOf(events)).toEqual(['1.1 first item', '1.2 second item', '1.3 third item'])
    // fresh prompts (t2, t3) and both validation-retry attempts (t1) carry the mandate
    const prompts = promptsOf(pipeline, 'implement-t1.json', 'implement-t2.json', 'implement-t3.json')
    expect(prompts).toHaveLength(4)
    for (const prompt of prompts) {
      expect(prompt).toContain('Plan the item with the todo tool before editing; keep the todo list current')
    }
    expect(pipeline.spawnPrompts['implement-t1.json']).toHaveLength(2)
    expect(promptsOf(pipeline, 'implement-t1.json')[1]).toContain('Previous attempt failed validation')
  })

  it('fix-shaped prompts carry the mandate line too (guard array, not the fresh branch)', async () => {
    const h = unitHarness({
      tasks: ALL_DONE,
      runFiles: {
        'verify-1.log': ['(fail) expects two to be three', 'src/old.ts:31:7'].join('\n'),
      },
      gitLogStdout: ['@@1.2 second item', 'src/old.ts', '@@1.1 first item', 'src/one.ts'].join('\n'),
    })
    await runImplementWork(h.deps, { changeName: 'add-thing' }, h.io)
    expect(h.prompts[0]).toContain('Fix one task of the change add-thing')
    expect(h.prompts[0]).toContain('Plan the item with the todo tool before editing; keep the todo list current')
  })
})

/** Fake clock: each tick resolves only when the test releases it. */
function fakeClock(): {
  readonly tick: () => Promise<void>
  readonly release: () => void
} {
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
