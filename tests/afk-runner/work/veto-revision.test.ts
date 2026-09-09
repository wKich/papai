// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

import { afterEach, describe, expect, it } from 'bun:test'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'

import { z } from 'zod'

import { agentWritePath } from '../../../afk-runner/src/agent-backend/agent-runner.js'
import type { RunnerConfig } from '../../../afk-runner/src/config.js'
import type { WorkIO } from '../../../afk-runner/src/drive/loop.js'
import type { SddEvent } from '../../../afk-runner/src/events.js'
import { stampEvent } from '../../../afk-runner/src/events.js'
import { initialKernelContext } from '../../../afk-runner/src/kernel/machine.js'
import type { KernelContext } from '../../../afk-runner/src/kernel/machine.js'
import { createOpenSpecDriver } from '../../../afk-runner/src/openspec-driver.js'
import type { OpenSpecDriver } from '../../../afk-runner/src/openspec-driver.js'
import type { GateAnswers } from '../../../afk-runner/src/work/gate-answers.js'
import { renderGateAnswers } from '../../../afk-runner/src/work/gate-answers.js'
import type { VetoRevisionDeps } from '../../../afk-runner/src/work/veto-revision.js'
import { runVetoRevision } from '../../../afk-runner/src/work/veto-revision.js'

const tmpDirs: string[] = []

afterEach(() => {
  while (tmpDirs.length > 0) {
    const dir = tmpDirs.pop()
    if (dir !== undefined) fs.rmSync(dir, { recursive: true, force: true })
  }
})

/** The round-1 resolver sidecar the gate presented from: one vetoable assumption. */
const RESOLUTIONS_1 = JSON.stringify({
  resolutions: [],
  assumptions: [
    {
      id: 'A1',
      text: 'guests stay read-only',
      basis: 'convention',
      confidence: 'high',
      blast_radius: 'group replies',
      status: 'open',
      evidence: { files: ['src/chat/context-scope.ts'] },
    },
  ],
})

/** The revised sidecar's read shape: the folded-back assumption redirects. */
const RevisedSidecar = z.object({
  assumptions: z.array(z.object({ id: z.string(), text: z.string() })),
})

interface RevisionHarness {
  readonly deps: VetoRevisionDeps
  readonly io: WorkIO
  readonly appended: SddEvent[]
  readonly spawnBasenames: string[]
  readonly prompts: string[]
  readonly runDir: string
  readonly sidecarPath: () => string
}

/** Direct-seam harness: a settled gate file on disk, real sidecars, a recording spawn. */
function makeRevision(gateAnswers: GateAnswers): RevisionHarness {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'afk-veto-revision-'))
  tmpDirs.push(dir)
  const runDir = path.join(dir, 'runs', 'r1')
  const sidecarDir = path.join(runDir, 'sidecars')
  fs.mkdirSync(sidecarDir, { recursive: true })
  fs.writeFileSync(path.join(sidecarDir, 'resolutions-1.json'), `${RESOLUTIONS_1}\n`)
  fs.writeFileSync(path.join(runDir, 'gate-1.md'), renderGateAnswers(gateAnswers))
  const appended: SddEvent[] = []
  const spawnBasenames: string[] = []
  const prompts: string[] = []
  const config: RunnerConfig = { repoRoot: dir, workDir: path.join(dir, '.sdd-runner'), model: 'm', budget: 5 }
  const driver: OpenSpecDriver = createOpenSpecDriver({
    exec: () => Promise.resolve({ stdout: 'is valid', stderr: '', exitCode: 0 }),
    cwd: dir,
  })
  const deps: VetoRevisionDeps = {
    driver,
    spawn: (_command, args, spawnOptions) => {
      const prompt = String(args[args.length - 1])
      prompts.push(prompt)
      const basename = prompt.match(/\.review-loop\/([\w-]+\.json)/u)?.[1] ?? 'unknown.json'
      spawnBasenames.push(basename)
      const target = agentWritePath(spawnOptions.cwd, basename)
      fs.mkdirSync(path.dirname(target), { recursive: true })
      fs.writeFileSync(target, JSON.stringify({ files_updated: ['openspec/changes/add-thing/proposal.md'] }))
      return Promise.resolve({ exitCode: 0, stdout: '', stderr: '' })
    },
    config,
    execGit: (_cwd, args) => Promise.resolve({ stdout: args.includes('log') ? '' : '', stderr: '' }),
  }
  const context: KernelContext = {
    ...initialKernelContext({}),
    gate: { mode: 'final', version: 1, answered: true },
    round: { current: 1, cap: 3 },
  }
  const io: WorkIO = {
    append: (event) => {
      const stamped = stampEvent(event, appended.length + 1, '2026-09-03T00:00:00.000Z')
      appended.push(stamped)
      return stamped
    },
    context,
    runDir,
  }
  return {
    deps,
    io,
    appended,
    spawnBasenames,
    prompts,
    runDir,
    sidecarPath: () => path.join(sidecarDir, 'resolutions-1.json'),
  }
}

describe('runVetoRevision — the settled-gate revision round (C4 D8/D6)', () => {
  it('an item veto folds the redirect into the resolver sidecar and runs the veto updater', async () => {
    const h = makeRevision({
      items: [{ kind: 'assumption', id: 'A1', text: 'guests stay read-only', accepted: false, redirect: 'dm-only' }],
      blockerAnswers: [],
      acks: [],
      decision: 'veto',
    })
    await runVetoRevision(h.deps, { changeName: 'add-thing' }, h.io)
    expect(h.spawnBasenames).toEqual(['veto-updater.json'])
    expect(h.prompts[0]).toContain('dm-only')
    const revised = RevisedSidecar.parse(JSON.parse(fs.readFileSync(h.sidecarPath(), 'utf8')))
    expect(revised.assumptions.find((entry) => entry.id === 'A1')?.text).toBe('dm-only')
  })

  it('a gate-level veto redirect reaches the updater as its own prompt section', async () => {
    const h = makeRevision({
      items: [],
      blockerAnswers: [],
      acks: [],
      decision: 'veto',
      gateVetoRedirect: 'redo the approach entirely',
    })
    await runVetoRevision(h.deps, { changeName: 'add-thing' }, h.io)
    expect(h.spawnBasenames).toEqual(['veto-updater.json'])
    expect(h.prompts[0]).toContain('Whole-gate redirect')
    expect(h.prompts[0]).toContain('redo the approach entirely')
  })

  it('a settled response with no vetoes and no gate veto is a no-op — no spawn, sidecar untouched', async () => {
    const h = makeRevision({
      items: [{ kind: 'assumption', id: 'A1', text: 'guests stay read-only', accepted: true }],
      blockerAnswers: [],
      acks: [],
      decision: 'approve',
    })
    const before = fs.readFileSync(h.sidecarPath(), 'utf8')
    await runVetoRevision(h.deps, { changeName: 'add-thing' }, h.io)
    expect(h.spawnBasenames).toEqual([])
    expect(fs.readFileSync(h.sidecarPath(), 'utf8')).toBe(before)
  })
})
