// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

import { afterEach, describe, expect, it } from 'bun:test'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'

import { renderRunsReport, summarizeWorkDir } from '../../afk-runner/src/accounting.js'
import { readAllRunStates, resolveRunId } from '../../afk-runner/src/run-index.js'
import { loadPortfolio } from '../../afk-runner/src/serve/load.js'

/**
 * One store, two worktrees (afk-runner-store): runs started from two distinct
 * repoRoots accumulate in one declared workDir; every read surface resolves
 * through it, the memos' repoRoot fields keep the runs attributable to their
 * worktree, and same-change-name runs never collide.
 */

const tmpDirs: string[] = []
const T0 = '2026-09-09T09:00:00.000Z'
const NOW = new Date('2026-09-09T10:00:00.000Z')

function makeDir(): string {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'afk-shared-store-'))
  tmpDirs.push(dir)
  return dir
}

afterEach(() => {
  while (tmpDirs.length > 0) {
    const dir = tmpDirs.pop()
    if (dir !== undefined) fs.rmSync(dir, { recursive: true, force: true })
  }
})

function writeStoreRun(store: string, runId: string, repoRoot: string, changeName: string): string {
  const runDir = path.join(store, 'runs', runId)
  fs.mkdirSync(runDir, { recursive: true })
  fs.writeFileSync(
    path.join(runDir, 'state.json'),
    `${JSON.stringify(
      {
        runId,
        repoRoot,
        workDir: store,
        changeName,
        stage: 'review',
        depth: 'S',
        round: 1,
        gate: null,
        status: 'completed',
        createdAt: T0,
        updatedAt: T0,
      },
      null,
      2,
    )}\n`,
  )
  fs.writeFileSync(
    path.join(runDir, 'events.ndjson'),
    `${JSON.stringify({ altitude: 'L2', type: 'stage_enter', stage: 'intake', seq: 1, ts: T0 })}\n`,
  )
  return runDir
}

/** The two-worktree fixture: one store, same change name from both repo roots. */
function sharedStoreFixture(): {
  readonly store: string
  readonly repoA: string
  readonly repoB: string
  readonly runA: string
  readonly runB: string
} {
  const store = makeDir()
  const repoA = makeDir()
  const repoB = makeDir()
  const runA = '20260909t090000z-aaaaaaaa'
  const runB = '20260909t090000z-bbbbbbbb'
  writeStoreRun(store, runA, repoA, 'shared-change')
  writeStoreRun(store, runB, repoB, 'shared-change')
  return { store, repoA, repoB, runA, runB }
}

describe('shared-store — one workDir, two worktrees', () => {
  it('the runs roster carries each memo’s repoRoot, keeping runs attributable', async () => {
    const { store, repoA, repoB, runA, runB } = sharedStoreFixture()
    const summary = await summarizeWorkDir(store)
    expect(summary.rows).toHaveLength(2)
    expect(summary.rows.find((row) => row.runId === runA)?.repoRoot).toBe(repoA)
    expect(summary.rows.find((row) => row.runId === runB)?.repoRoot).toBe(repoB)
    expect(summary.totals.runs).toBe(2)
  })

  it('the rendered roster distinguishes the worktrees when the store is shared', async () => {
    const { store, repoA, repoB } = sharedStoreFixture()
    const text = renderRunsReport(await summarizeWorkDir(store))
    expect(text).toContain(repoA)
    expect(text).toContain(repoB)
  })

  it('a single-repo roster keeps the classic column shape — no repo column', async () => {
    const store = makeDir()
    const repo = makeDir()
    writeStoreRun(store, '20260909t090000z-solo', repo, 'solo-change')
    const text = renderRunsReport(await summarizeWorkDir(store))
    expect(text).not.toContain('repo')
    expect(text).not.toContain(repo)
    expect(text).toContain('20260909t090000z-solo')
  })

  it('the serve portfolio cards carry each memo’s repoRoot', async () => {
    const { store, repoA, repoB, runA, runB } = sharedStoreFixture()
    const portfolio = await loadPortfolio(store, NOW)
    expect(portfolio.totals.runs).toBe(2)
    const cardA = portfolio.cards.find((card) => card.runId === runA)
    const cardB = portfolio.cards.find((card) => card.runId === runB)
    expect(cardA?.repoRoot).toBe(repoA)
    expect(cardB?.repoRoot).toBe(repoB)
  })

  it('run-id resolution works over the store: exact, unique prefix, ambiguous loud', async () => {
    const { store, runA, runB } = sharedStoreFixture()
    await expect(resolveRunId(store, runA)).resolves.toBe(runA)
    await expect(resolveRunId(store, '20260909t090000z-a')).resolves.toBe(runA)
    const ambiguous = resolveRunId(store, '20260909t090000z-')
    await expect(ambiguous).rejects.toThrow(/ambiguous/u)
    await expect(ambiguous).rejects.toThrow(new RegExp(`${runA}|${runB}`, 'u'))
  })

  it('same change name from two worktrees keeps independent directories and logs', async () => {
    const { store, runA, runB } = sharedStoreFixture()
    const dirA = path.join(store, 'runs', runA)
    const dirB = path.join(store, 'runs', runB)
    expect(dirA).not.toBe(dirB)
    for (const dir of [dirA, dirB]) {
      expect(fs.existsSync(path.join(dir, 'state.json'))).toBe(true)
      expect(fs.existsSync(path.join(dir, 'events.ndjson'))).toBe(true)
    }
    const roster = await readAllRunStates(store)
    expect(roster).toHaveLength(2)
    expect(new Set(roster.map((entry) => entry.repoRoot)).size).toBe(2)
  })
})
