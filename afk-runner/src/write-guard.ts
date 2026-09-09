// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

import { parsePorcelainPaths } from '../../mutation-improve/src/diff-guard.js'
import type { ExecGitFn } from './config.js'

/**
 * The write set one spawn may dirty (U3 D6). Narrow mode (no
 * `allowedExcept`): every newly dirtied path must sit under
 * `allowedPrefix` — the change folder guard every think-half seam keeps.
 * Widened mode: every newly dirtied path passes except a path under an
 * `allowedExcept` prefix yet outside `allowedPrefix` (another change's
 * folder) — the implementer seam's repo-wide-minus-siblings write set. No
 * silent tree-wide default exists on purpose; a seam needing different
 * terms declares them explicitly here and re-pins the guard tests.
 */
export interface WriteGuard {
  readonly allowedPrefix: string
  readonly allowedExcept?: readonly string[]
}

/** The trailing-slash change-folder prefix — load-bearing: it is what makes a prefix-sharing sibling a violation. */
export function changeFolderPrefix(changeName: string): string {
  return `openspec/changes/${changeName}/`
}

/** The widened mode's protected prefixes — null means the narrow change-folder-only mode. */
function widenedExceptOf(guard: WriteGuard): readonly string[] | null {
  if (guard.allowedExcept === undefined || guard.allowedExcept.length === 0) return null
  return guard.allowedExcept
}

export class DiffGuardViolationError extends Error {
  readonly violations: readonly string[]
  readonly allowedPrefix: string

  constructor(violations: readonly string[], guard: WriteGuard) {
    super(violationMessage(violations, guard))
    this.name = 'DiffGuardViolationError'
    this.violations = violations
    this.allowedPrefix = guard.allowedPrefix
  }
}

function violationMessage(violations: readonly string[], guard: WriteGuard): string {
  const paths = violations.join(', ')
  const excepts = widenedExceptOf(guard)
  if (excepts === null) {
    return `agent edited files outside the change folder ${guard.allowedPrefix}: ${paths}`
  }
  return `agent edited files in a protected change folder (writes under ${excepts.join(', ')} must stay within ${guard.allowedPrefix}): ${paths}`
}

/** A newly dirtied path the guard refuses: outside the allowed prefix, and — in the widened mode — inside a protected prefix. */
function isNewViolation(entry: string, before: Set<string>, guard: WriteGuard): boolean {
  if (before.has(entry)) return false
  if (entry.startsWith(guard.allowedPrefix)) return false
  const excepts = widenedExceptOf(guard)
  if (excepts === null) return true
  return excepts.some((prefix) => entry.startsWith(prefix))
}

function parseDirty(stdout: string): string[] {
  return stdout
    .split('\n')
    .filter((line) => line.trim().length > 0)
    .flatMap(parsePorcelainPaths)
    .filter((entry) => entry.length > 0)
}

export async function snapshotWorkingTree(execGit: ExecGitFn, cwd: string): Promise<Set<string>> {
  const { stdout } = await execGit(cwd, ['status', '--porcelain', '--untracked-files=all'])
  return new Set(parseDirty(stdout))
}

export async function guardWorkingTree(
  execGit: ExecGitFn,
  cwd: string,
  before: Set<string>,
  guard: WriteGuard,
): Promise<void> {
  const after = await snapshotWorkingTree(execGit, cwd)
  const violations = [...after].filter((entry) => isNewViolation(entry, before, guard))
  if (violations.length > 0) throw new DiffGuardViolationError(violations, guard)
}
