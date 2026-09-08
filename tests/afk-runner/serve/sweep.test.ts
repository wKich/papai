// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

import { afterEach, describe, expect, it } from 'bun:test'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'

import { nodeServeFs } from '../../../afk-runner/src/serve/fs-seam.js'
import { emptyRoster, sweepRuns } from '../../../afk-runner/src/serve/sweep.js'

/**
 * The board's polling mtime sweep (web-board D5): a pure "scan run dirs →
 * changed run ids" over memoized (size, mtime) fingerprints. Roster growth
 * (a new run dir) counts as a change; a torn tail is just a size change —
 * tolerance stays readEvents' business (no new tolerance logic).
 */

const tmpDirs: string[] = []

afterEach(() => {
  while (tmpDirs.length > 0) {
    const dir = tmpDirs.pop()
    if (dir !== undefined) fs.rmSync(dir, { recursive: true, force: true })
  }
})

function makeWorkDir(): string {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'afk-serve-sweep-'))
  tmpDirs.push(dir)
  return dir
}

function writeRunDir(workDir: string, runId: string, log: string, memo: string): string {
  const runDir = path.join(workDir, 'runs', runId)
  fs.mkdirSync(runDir, { recursive: true })
  fs.writeFileSync(path.join(runDir, 'events.ndjson'), log)
  fs.writeFileSync(path.join(runDir, 'state.json'), memo)
  return runDir
}

describe('serve sweep — scan run dirs to changed run ids', () => {
  it('the first sweep reports every run as changed with its fingerprints', async () => {
    const workDir = makeWorkDir()
    writeRunDir(workDir, 'run-a', 'event-1\n', '{}\n')
    writeRunDir(workDir, 'run-b', 'event-1\nevent-2\n', '{}\n')
    const result = await sweepRuns(nodeServeFs(), workDir, emptyRoster())
    expect([...result.changed].sort()).toEqual(['run-a', 'run-b'])
    expect(result.roster['run-a']?.events).toMatchObject({ size: 8 })
    expect(result.roster['run-a']?.memo).not.toBeNull()
    expect(result.roster['run-b']?.events).toMatchObject({ size: 16 })
  })

  it('a rescan over unchanged run dirs reports no changes', async () => {
    const workDir = makeWorkDir()
    writeRunDir(workDir, 'run-a', 'event-1\n', '{}\n')
    const first = await sweepRuns(nodeServeFs(), workDir, emptyRoster())
    const second = await sweepRuns(nodeServeFs(), workDir, first.roster)
    expect(second.changed).toEqual([])
    expect(second.roster).toEqual(first.roster)
  })

  it('an event append or memo write changes exactly that run', async () => {
    const workDir = makeWorkDir()
    const runDirA = writeRunDir(workDir, 'run-a', 'event-1\n', '{}\n')
    writeRunDir(workDir, 'run-b', 'event-1\n', '{}\n')
    const first = await sweepRuns(nodeServeFs(), workDir, emptyRoster())

    fs.appendFileSync(path.join(runDirA, 'events.ndjson'), 'event-2\n')
    const afterAppend = await sweepRuns(nodeServeFs(), workDir, first.roster)
    expect(afterAppend.changed).toEqual(['run-a'])

    fs.writeFileSync(path.join(runDirA, 'state.json'), '{"status":"completed"}\n')
    const afterMemo = await sweepRuns(nodeServeFs(), workDir, afterAppend.roster)
    expect(afterMemo.changed).toEqual(['run-a'])
  })

  it('roster growth (a new run dir) counts as a change', async () => {
    const workDir = makeWorkDir()
    writeRunDir(workDir, 'run-a', 'event-1\n', '{}\n')
    const first = await sweepRuns(nodeServeFs(), workDir, emptyRoster())
    writeRunDir(workDir, 'run-new', '', '{}\n')
    const second = await sweepRuns(nodeServeFs(), workDir, first.roster)
    expect(second.changed).toEqual(['run-new'])
    expect(second.roster['run-new']?.events).toMatchObject({ size: 0 })
  })

  it('a removed run dir is a change and drops from the roster', async () => {
    const workDir = makeWorkDir()
    const runDir = writeRunDir(workDir, 'run-gone', 'event-1\n', '{}\n')
    writeRunDir(workDir, 'run-stays', 'event-1\n', '{}\n')
    const first = await sweepRuns(nodeServeFs(), workDir, emptyRoster())
    fs.rmSync(runDir, { recursive: true, force: true })
    const second = await sweepRuns(nodeServeFs(), workDir, first.roster)
    expect(second.changed).toEqual(['run-gone'])
    expect(second.roster['run-gone']).toBeUndefined()
    expect(second.roster['run-stays']).not.toBeUndefined()
  })

  it('a missing runs dir and non-directory entries are not changes', async () => {
    const workDir = makeWorkDir()
    const empty = await sweepRuns(nodeServeFs(), workDir, emptyRoster())
    expect(empty.changed).toEqual([])
    expect(empty.roster).toEqual({})
    fs.mkdirSync(path.join(workDir, 'runs'))
    fs.writeFileSync(path.join(workDir, 'runs', 'stray.txt'), 'not a run\n')
    const withStray = await sweepRuns(nodeServeFs(), workDir, emptyRoster())
    expect(withStray.changed).toEqual([])
    expect(withStray.roster).toEqual({})
  })

  it('a run dir missing its artifacts fingerprints null and still detects later writes', async () => {
    const workDir = makeWorkDir()
    fs.mkdirSync(path.join(workDir, 'runs', 'bare'), { recursive: true })
    const first = await sweepRuns(nodeServeFs(), workDir, emptyRoster())
    expect(first.changed).toEqual(['bare'])
    expect(first.roster['bare']).toEqual({ events: null, memo: null })
    fs.writeFileSync(path.join(workDir, 'runs', 'bare', 'events.ndjson'), 'event-1\n')
    const second = await sweepRuns(nodeServeFs(), workDir, first.roster)
    expect(second.changed).toEqual(['bare'])
  })
})
