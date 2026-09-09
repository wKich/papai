// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

import { afterEach, describe, expect, it } from 'bun:test'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'

import type { ExecGitFn } from '../../../afk-runner/src/config.js'
import { StageHaltError } from '../../../afk-runner/src/errors.js'
import { commitTaskSlice } from '../../../afk-runner/src/work/slice-commit.js'
import type { TaskItem } from '../../../afk-runner/src/work/tasks-md.js'

const tmpDirs: string[] = []

function makeDir(): string {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'sdd-slice-commit-'))
  tmpDirs.push(dir)
  return dir
}

afterEach(() => {
  while (tmpDirs.length > 0) {
    const dir = tmpDirs.pop()
    if (dir !== undefined) fs.rmSync(dir, { recursive: true, force: true })
  }
})

const TASKS_MD = ['- [ ] 1.1 first item', '- [ ] 1.2 second item', '- [ ] 1.3 third item', ''].join('\n')

const SECOND_ITEM: TaskItem = { id: '2', lineNo: 2, checked: false, text: '1.2 second item' }

interface Harness {
  readonly changeDir: string
  readonly cwd: string
  readonly tasksMdPath: string
  readonly gitCalls: string[][]
  readonly execGit: ExecGitFn
}

function harness(): Harness {
  const dir = makeDir()
  const changeDir = path.join(dir, 'change')
  fs.mkdirSync(changeDir, { recursive: true })
  const tasksMdPath = path.join(changeDir, 'tasks.md')
  fs.writeFileSync(tasksMdPath, TASKS_MD)
  const gitCalls: string[][] = []
  const execGit: ExecGitFn = (_cwd, args) => {
    gitCalls.push([...args])
    return Promise.resolve({ stdout: '', stderr: '' })
  }
  return { changeDir, cwd: dir, tasksMdPath, gitCalls, execGit }
}

describe('commitTaskSlice — the runner-issued slice commit (U3 D4)', () => {
  it('flips the item checkbox and stages everything in one commit led by the task line', async () => {
    const h = harness()
    await commitTaskSlice({ execGit: h.execGit, cwd: h.cwd, changeDir: h.changeDir }, SECOND_ITEM)
    expect(fs.readFileSync(h.tasksMdPath, 'utf8')).toBe(
      ['- [ ] 1.1 first item', '- [x] 1.2 second item', '- [ ] 1.3 third item', ''].join('\n'),
    )
    expect(h.gitCalls).toEqual([
      ['add', '-A'],
      ['commit', '--no-verify', '-m', '1.2 second item'],
    ])
  })

  it('an already-checked line commits the fix without rewriting the file', async () => {
    const h = harness()
    const checked = ['- [ ] 1.1 first item', '- [x] 1.2 second item', '- [ ] 1.3 third item', ''].join('\n')
    fs.writeFileSync(h.tasksMdPath, checked)
    await commitTaskSlice({ execGit: h.execGit, cwd: h.cwd, changeDir: h.changeDir }, { ...SECOND_ITEM, checked: true })
    expect(fs.readFileSync(h.tasksMdPath, 'utf8')).toBe(checked)
    expect(h.gitCalls).toEqual([
      ['add', '-A'],
      ['commit', '--no-verify', '-m', '1.2 second item'],
    ])
  })

  it('a checkbox line that moved out from under the item refuses loudly', async () => {
    const h = harness()
    fs.writeFileSync(
      h.tasksMdPath,
      ['- [ ] 1.1 first item', 'rewritten mid-walk', '- [ ] 1.3 third item', ''].join('\n'),
    )
    await expect(
      commitTaskSlice({ execGit: h.execGit, cwd: h.cwd, changeDir: h.changeDir }, SECOND_ITEM),
    ).rejects.toThrow(/line 2/u)
    expect(h.gitCalls).toEqual([])
  })
})

describe('structural precondition halt — commit-time tasks.md read (walk-robustness F-W1)', () => {
  it('a missing tasks.md at commit time rejects as StageHaltError{precondition} with the restoration resume hint, before any git call', async () => {
    const h = harness()
    fs.rmSync(h.tasksMdPath)
    let caught: unknown
    try {
      await commitTaskSlice({ execGit: h.execGit, cwd: h.cwd, changeDir: h.changeDir }, SECOND_ITEM)
    } catch (error) {
      caught = error
    }
    expect(caught).toBeInstanceOf(StageHaltError)
    expect(caught).toMatchObject({
      kind: 'precondition',
      resumeHint: 'resume after the change folder is restored',
    })
    expect(String(caught)).toContain('cannot read')
    expect(String(caught)).toContain(h.tasksMdPath)
    expect(h.gitCalls).toEqual([])
  })

  it('an unreadable tasks.md at commit time (EISDIR) rejects with the same precondition shape, not a plain Error', async () => {
    const h = harness()
    fs.rmSync(h.tasksMdPath)
    fs.mkdirSync(h.tasksMdPath)
    let caught: unknown
    try {
      await commitTaskSlice({ execGit: h.execGit, cwd: h.cwd, changeDir: h.changeDir }, SECOND_ITEM)
    } catch (error) {
      caught = error
    }
    expect(caught).toBeInstanceOf(StageHaltError)
    expect(caught).toMatchObject({
      kind: 'precondition',
      resumeHint: 'resume after the change folder is restored',
    })
    expect(String(caught)).toContain('cannot read')
    expect(h.gitCalls).toEqual([])
  })
})
