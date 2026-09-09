// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

import { afterEach, describe, expect, it } from 'bun:test'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'

import type { ExecGitFn } from '../../../afk-runner/src/config.js'
import { fixTargetOf, releaseVetoOwed } from '../../../afk-runner/src/work/fix-target.js'
import type { FixTargetDeps } from '../../../afk-runner/src/work/fix-target.js'
import { parseTaskItems } from '../../../afk-runner/src/work/tasks-md.js'
import type { TaskItem } from '../../../afk-runner/src/work/tasks-md.js'
import { assertEach, type Row } from '../grouped-assertions.js'

const tmpDirs: string[] = []

afterEach(() => {
  while (tmpDirs.length > 0) {
    const dir = tmpDirs.pop()
    if (dir !== undefined) fs.rmSync(dir, { recursive: true, force: true })
  }
})

const ITEMS: readonly TaskItem[] = parseTaskItems('- [x] 1.1 first item\n- [x] 1.2 second item\n- [x] 1.3 third item\n')

function harness(
  options: {
    readonly runFiles?: Record<string, string>
    readonly gitLogStdout?: string
  } = {},
): FixTargetDeps {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'sdd-fix-target-'))
  tmpDirs.push(dir)
  const runDir = path.join(dir, 'runs', 'r1')
  fs.mkdirSync(runDir, { recursive: true })
  for (const [name, body] of Object.entries(options.runFiles ?? {})) {
    fs.writeFileSync(path.join(runDir, name), body)
  }
  const execGit: ExecGitFn = (_cwd, args): Promise<{ stdout: string; stderr: string }> =>
    Promise.resolve({ stdout: args.includes('log') ? (options.gitLogStdout ?? '') : '', stderr: '' })
  return { execGit, runDir, cwd: dir }
}

describe('fixTargetOf — culprit mapping and fallbacks (D4/D7)', () => {
  it('maps the failing path to the item whose slice commit last touched it', async () => {
    const deps = harness({
      runFiles: { 'verify-1.log': '(fail) expects two to be three\nsrc/old.ts:31:7\n' },
      gitLogStdout: ['@@1.3 third item', 'src/three.ts', '@@1.2 second item', 'src/two.ts', 'src/old.ts'].join('\n'),
    })
    const target = await fixTargetOf(deps, ITEMS, {})
    expect(target).toMatchObject({ item: { id: '2' }, cause: 'verify' })
    expect(target?.failingTail).toContain('src/old.ts:31:7')
  })

  it('falls back to the last-walked id when no failing path maps', async () => {
    const deps = harness({
      runFiles: { 'verify-1.log': '(fail) expects two to be three\nsrc/unmapped.ts:1:1\n' },
      gitLogStdout: ['@@1.1 first item', 'src/one.ts'].join('\n'),
    })
    const target = await fixTargetOf(deps, ITEMS, { '1': { status: 'done', attempts: 1 } })
    expect(target).toMatchObject({ item: { id: '1' }, cause: 'verify' })
  })

  it('an unanswered release veto targets the last-walked item with the redirect as the tail', async () => {
    const deps = harness({
      runFiles: { 'release-veto.md': '<!-- release-veto.md -->\nVETO: tighten the error copy\n' },
    })
    const target = await fixTargetOf(deps, ITEMS, { '2': { status: 'done', attempts: 1 } })
    expect(target).toMatchObject({ item: { id: '2' }, failingTail: 'tighten the error copy', cause: 'veto' })
  })

  it('no fix context at all owes nothing', async () => {
    const deps = harness()
    const target = await fixTargetOf(deps, ITEMS, { '3': { status: 'done', attempts: 1 } })
    expect(target).toBeNull()
  })
})

describe('releaseVetoOwed — the sidecar answer ledger (D7)', () => {
  interface CaseFields {
    readonly label: string
    readonly files: Record<string, string>
    readonly owed: boolean
  }

  type CaseRow = Row<CaseFields>

  const rows: readonly CaseRow[] = [
    { label: 'absent sidecar owes nothing', files: {}, owed: false },
    { label: 'an open veto redirect owes the fix', files: { 'release-veto.md': 'VETO: tighten\n' }, owed: true },
    {
      label: 'a fix-answered sidecar owes nothing',
      files: { 'release-veto.md': 'VETO: tighten\nfix answered: task 2\n' },
      owed: false,
    },
  ]

  it('owed matrix', async () => {
    await assertEach(rows, (row) => {
      const deps = harness({ runFiles: row.files })
      expect(releaseVetoOwed(deps.runDir)).toBe(row.owed)
    })
  })
})
