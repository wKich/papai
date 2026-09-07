// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

import { afterEach, describe, expect, it } from 'bun:test'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'

import type { RunnerConfig } from '../../../afk-runner/src/config.js'
import type { ExecGitFn } from '../../../afk-runner/src/config.js'
import type { WorkIO } from '../../../afk-runner/src/drive/loop.js'
import type { SddEvent } from '../../../afk-runner/src/events.js'
import { appendEvent, readEvents, stampEvent } from '../../../afk-runner/src/events.js'
import { workForOf } from '../../../afk-runner/src/graph/pipeline-work.js'
import { initialKernelContext } from '../../../afk-runner/src/kernel/machine.js'
import { parseGateResponse } from '../../../afk-runner/src/work/gate-model.js'
import { presentReleaseGate } from '../../../afk-runner/src/work/present-release.js'
import { TASK_TEXT, makeFakePipeline } from '../fixtures/fake-pipeline.js'

const tmpDirs: string[] = []

afterEach(() => {
  while (tmpDirs.length > 0) {
    const dir = tmpDirs.pop()
    if (dir !== undefined) fs.rmSync(dir, { recursive: true, force: true })
  }
})

const TASKS_MD = ['## 1. Walk', '', '- [x] 1.1 first item', '- [x] 1.2 second item', '- [ ] 1.3 third item', ''].join(
  '\n',
)

interface ReleaseHarness {
  readonly runDir: string
  readonly logPath: string
  readonly appended: SddEvent[]
  readonly gateMdPath: (version: number) => string
}

/** A release-presentation harness: an armed walk log at the release boundary. */
function makeHarness(): ReleaseHarness {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'sdd-release-'))
  tmpDirs.push(dir)
  const runDir = path.join(dir, 'runs', 'r1')
  fs.mkdirSync(runDir, { recursive: true })
  const changeDir = path.join(dir, 'openspec', 'changes', 'add-thing')
  fs.mkdirSync(changeDir, { recursive: true })
  fs.writeFileSync(path.join(changeDir, 'tasks.md'), TASKS_MD)
  fs.writeFileSync(path.join(changeDir, 'proposal.md'), '# Add thing\n\n## WHAT\nfixes a typo\n')
  const logPath = path.join(runDir, 'events.ndjson')
  appendEvent(logPath, { altitude: 'L2', type: 'execution', action: 'armed' })
  appendEvent(logPath, { altitude: 'L2', type: 'stage_enter', stage: 'implement' })
  for (const id of ['1', '2']) {
    appendEvent(logPath, { altitude: 'L2', type: 'task', action: 'started', id })
    appendEvent(logPath, { altitude: 'L2', type: 'task', action: 'done', id })
  }
  appendEvent(logPath, { altitude: 'L2', type: 'gate', action: 'presented', mode: 'final', version: 1 })
  fs.writeFileSync(path.join(runDir, 'verify-1.log'), 'verdict: red\nfix answered: task 2\n')
  fs.writeFileSync(path.join(runDir, 'verify-2.log'), 'verdict: green\n')
  const appended: SddEvent[] = []
  return {
    runDir,
    logPath,
    appended,
    gateMdPath: (version: number): string => path.join(runDir, `gate-${String(version)}.md`),
  }
}

function releaseDeps(
  dir: string,
  gitLogStdout: string,
): {
  readonly config: RunnerConfig
  readonly repoRoot: string
  readonly changeName: string
  readonly execGit: ExecGitFn
} {
  const config: RunnerConfig = {
    repoRoot: dir,
    workDir: path.join(dir, '.sdd-runner'),
    model: 'm',
    budget: 5,
  }
  const execGit: ExecGitFn = (_cwd, args): Promise<{ stdout: string; stderr: string }> =>
    Promise.resolve({ stdout: args.includes('log') ? gitLogStdout : '', stderr: '' })
  return { config, repoRoot: dir, changeName: 'add-thing', execGit }
}

function ioOf(runDir: string, appended: SddEvent[]): WorkIO {
  return {
    append: (event) => {
      const stamped = stampEvent(event, appended.length + 1, '2026-09-03T00:00:00.000Z')
      appended.push(stamped)
      return stamped
    },
    context: initialKernelContext({}),
    runDir,
  }
}

/** The gate answered events of a log — the never-settling ladder leaves none. */
function answeredEvents(events: readonly { readonly type: string; readonly action?: string }[]): readonly unknown[] {
  return events.filter((event) => event.type === 'gate' && event.action === 'answered')
}

/** The presentation's appended events as type:key tokens — stage enters key by stage, gates by mode. */
function presentationTokens(events: readonly SddEvent[]): readonly string[] {
  return events.map((event) => {
    if (event.type === 'stage_enter' || event.type === 'stage_exit') return `${event.type}:${event.stage}`
    if (event.type === 'gate') return `gate:${event.mode}`
    return event.type
  })
}

describe('release presentation (U3 D7)', () => {
  it('presents gate mode release at max-version+1: files first, stage entry, presented event', async () => {
    const h = makeHarness()
    const result = await presentReleaseGate(
      { ...releaseDeps(path.dirname(path.dirname(h.runDir)), '@@1.1 first item\n@@1.2 second item\n') },
      ioOf(h.runDir, h.appended),
    )
    expect(result.version).toBe(2)
    expect(fs.existsSync(h.gateMdPath(2))).toBe(true)
    expect(fs.existsSync(path.join(h.runDir, 'gate-hashes-2.json'))).toBe(true)
    expect(presentationTokens(h.appended)).toEqual(['stage_enter:gate', 'gate:release', 'auto_decision'])
    const presented = h.appended[1]
    expect(presented).toMatchObject({ type: 'gate', action: 'presented', mode: 'release', version: 2 })
  })

  it('the gate file carries the execution digest: tasks done/total, verify outcomes, commits, cost', async () => {
    const h = makeHarness()
    const dir = path.dirname(path.dirname(h.runDir))
    await presentReleaseGate(
      { ...releaseDeps(dir, '@@1.1 first item\n@@1.2 second item\n@@1.3 third item\n') },
      ioOf(h.runDir, h.appended),
    )
    const md = fs.readFileSync(h.gateMdPath(2), 'utf8')
    expect(md).toContain('## Release gate — change add-thing')
    expect(md).toContain('### Execution digest')
    expect(md).toContain('Tasks: 2/3 done')
    expect(md).toContain('verify-1: red')
    expect(md).toContain('verify-2: green')
    expect(md).toContain('commits: 3')
    expect(md).toContain('### Cost / duration')
    expect(md).toContain('### Change digest')
  })

  it('the decisions block names approve/veto/abort consequences and offers no extend', async () => {
    const h = makeHarness()
    const dir = path.dirname(path.dirname(h.runDir))
    await presentReleaseGate({ ...releaseDeps(dir, '') }, ioOf(h.runDir, h.appended))
    const md = fs.readFileSync(h.gateMdPath(2), 'utf8')
    expect(md).toContain('### Decisions')
    const decisions = md.slice(md.indexOf('### Decisions'), md.indexOf('### Summary'))
    expect(decisions).toContain('- **approve** (`APPROVE`) — completes the run')
    expect(decisions).toContain('- **veto** (`VETO: <redirect>`) — re-enters implement applying the redirects')
    expect(decisions).toContain('- **abort** (`ABORT`) — aborts the run')
    expect(decisions).not.toContain('**extend**')
    expect(md).not.toContain('RUN 1 MORE')
  })

  it('the ladder logs rule none and no rung settles: an auto_decision, never a gate answered', async () => {
    const h = makeHarness()
    const dir = path.dirname(path.dirname(h.runDir))
    await presentReleaseGate({ ...releaseDeps(dir, '') }, ioOf(h.runDir, h.appended))
    const decision = h.appended.find((event) => event.type === 'auto_decision')
    expect(decision).toMatchObject({ rule: 'none', decision: 'gate', gateVersion: 2 })
    expect(answeredEvents(h.appended)).toEqual([])
    expect(answeredEvents(readEvents(h.logPath))).toEqual([])
  })

  it('the response grammar rejects extend at a release gate', () => {
    expect(() =>
      parseGateResponse('## Release gate\n\n→ RUN 1 MORE\n', { assumptions: [], blockers: [], gateMode: 'release' }),
    ).toThrow(/extend is not valid at a release gate/u)
  })

  it('workForOf maps the release state to the presentation work parking gate-pending', () => {
    const pipeline = makeFakePipeline()
    const module = workForOf(
      pipeline.deps,
      { taskText: TASK_TEXT, changeName: 'add-thing' },
      path.join(pipeline.deps.config.workDir, 'runs', 'probe'),
    )('release')
    expect(module).not.toBeNull()
    expect(module?.work?.kind).toBe('release')
    expect(module?.successors).toEqual({
      incomplete: { enter: 'release' },
      presented: { park: 'gate-pending' },
    })
  })
})
