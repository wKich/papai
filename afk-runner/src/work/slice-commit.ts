// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

import { readFile, writeFile } from 'node:fs/promises'
import path from 'node:path'

import type { ExecGitFn } from '../config.js'
import type { TaskItem } from './tasks-md.js'

export interface SliceCommitDeps {
  readonly execGit: ExecGitFn
  readonly cwd: string
  readonly changeDir: string
}

/**
 * The runner-issued slice commit (U3 D4): flip the item's checkbox, then
 * `git add -A` + `git commit` with the task line as the message — the
 * checked box and the work land in one commit, so the change folder never
 * claims work the tree lacks. The commit inherits the process environment,
 * so a GIT_AUTHOR/GIT_COMMITTER identity applied by the launching
 * environment (the review-loop `git-identity.ts` contract) reaches it
 * unchanged. The commit bypasses repo hooks (`--no-verify`): the verify
 * boundary is the walk's quality gate, while a per-commit pre-commit hook
 * re-checks the whole accumulating staged set — one red item poisoning
 * every later slice commit — and EXEC_GIT's contract carries no exit code,
 * so a hook rejection fails silently with the item already marked done
 * (the Run P live finding). An already-checked line (fix-mode re-work)
 * commits without a rewrite; a checkbox line that moved out from under the
 * item refuses loudly rather than checking the wrong box.
 */
export async function commitTaskSlice(deps: SliceCommitDeps, item: TaskItem): Promise<void> {
  const tasksPath = path.join(deps.changeDir, 'tasks.md')
  const tasksMd = await readFile(tasksPath, 'utf8')
  const lines = tasksMd.split('\n')
  const lineIndex = item.lineNo - 1
  const target = lines[lineIndex]
  if (target === undefined || !/^\s*- \[[ xX]\]/u.test(target)) {
    throw new Error(`tasks.md line ${String(item.lineNo)} is no longer the item's checkbox: ${target ?? '<eof>'}`)
  }
  if (!/^\s*- \[ \]/u.test(target)) {
    await deps.execGit(deps.cwd, ['add', '-A'])
    await deps.execGit(deps.cwd, ['commit', '--no-verify', '-m', item.text])
    return
  }
  lines[lineIndex] = target.replace(/^(\s*)- \[ \]/u, '$1- [x]')
  await writeFile(tasksPath, lines.join('\n'), 'utf8')
  await deps.execGit(deps.cwd, ['add', '-A'])
  await deps.execGit(deps.cwd, ['commit', '--no-verify', '-m', item.text])
}
