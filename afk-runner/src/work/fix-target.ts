// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

import { readFileSync } from 'node:fs'
import { readFile } from 'node:fs/promises'
import path from 'node:path'

import type { ExecGitFn } from '../config.js'
import type { KernelContext } from '../kernel/machine.js'
import type { TaskItem } from './tasks-md.js'
import { newestVerifyLogPath } from './verify.js'

/** A fix-mode target (U3 D4/D7): the re-worked item, its context tail, and the artifact that asked. */
export interface FixTarget {
  readonly item: TaskItem
  readonly failingTail: string
  readonly cause: 'verify' | 'veto'
}

/** The narrow seam fix targeting needs: the run's artifacts and git history. */
export interface FixTargetDeps {
  readonly execGit: ExecGitFn
  readonly runDir: string
  readonly cwd: string
}

/** The newest verify boundary log body — fix context re-read from the run's own artifacts (D4 fix mode). */
async function newestVerifyLog(runDir: string): Promise<string | null> {
  const logPath = newestVerifyLogPath(runDir)
  if (logPath === null) return null
  try {
    return await readFile(logPath, 'utf8')
  } catch {
    return null
  }
}

/** The release-veto sidecar body — null when absent or already answered by a fix (U3 D7). */
function releaseVetoBody(runDir: string): string | null {
  try {
    const body = readFileSync(path.join(runDir, 'release-veto.md'), 'utf8')
    const lines = body.split('\n').filter((line) => line.length > 0)
    const last = lines[lines.length - 1]
    if (last !== undefined && last.startsWith('fix answered:')) return null
    return body
  } catch {
    return null
  }
}

/** An unanswered release veto owes implement a fix (U3 D7) — the outcome composer's veto arm. */
export function releaseVetoOwed(runDir: string): boolean {
  return releaseVetoBody(runDir) !== null
}

/** Repo-relative file paths a failing verification output names: `path:line:col` tokens and bare path lines. */
function failingPathsOf(logBody: string): Set<string> {
  const paths = new Set<string>()
  for (const match of logBody.matchAll(/(?:^|[\s`(])([^\s:`(]+\.[a-z]+):\d+:\d+/gu)) {
    const captured = match[1]
    if (captured !== undefined) paths.add(captured)
  }
  for (const line of logBody.split('\n')) {
    const bare = /^\s*([^\s]+\.(?:ts|tsx|js|mjs|json|svelte))\s*$/u.exec(line)
    if (bare !== null && bare[1] !== undefined) paths.add(bare[1])
  }
  return paths
}

interface SliceCommit {
  readonly subject: string
  readonly paths: readonly string[]
}

/** Parse `git log --name-only --format=@@%s` output into commit blocks, preserving git's latest-first order. */
function parseSliceCommits(stdout: string): readonly SliceCommit[] {
  const commits: SliceCommit[] = []
  for (const line of stdout.split('\n')) {
    if (line.startsWith('@@')) {
      commits.push({ subject: line.slice(2), paths: [] })
      continue
    }
    const trimmed = line.trim()
    if (trimmed.length > 0 && commits.length > 0) {
      const current = commits[commits.length - 1]
      if (current !== undefined) {
        commits[commits.length - 1] = { subject: current.subject, paths: [...current.paths, trimmed] }
      }
    }
  }
  return commits
}

/** The last-walked id from the residue: the max numeric key over the task records. */
function lastWalkedIdOf(tasks: KernelContext['tasks']): string | null {
  let max: number | null = null
  for (const id of Object.keys(tasks)) {
    const numeric = Number(id)
    if (Number.isFinite(numeric) && (max === null || numeric > max)) max = numeric
  }
  return max === null ? null : String(max)
}

/** The sidecar's veto instruction — the `VETO:` payload, or the whole body when shaped unexpectedly. */
function vetoTailOf(body: string): string {
  const line = body.split('\n').find((candidate) => candidate.startsWith('VETO: '))
  return line === undefined ? body : line.slice('VETO: '.length)
}

/**
 * Fix mode (D4/D7): with every item recorded done, re-target the culprit.
 * An unanswered release veto (U3 D7) fixes the last-walked item with the
 * operator's redirect as the tail; a verify boundary log maps the item whose
 * runner-made slice commit last touched a path the failing output names —
 * falling back to the last-walked id when nothing maps. The re-target
 * re-emits `task started` (last-state-wins flips the record to running;
 * the attempt bound governs thrash) and the spawn embeds the tail.
 */
export async function fixTargetOf(
  deps: FixTargetDeps,
  items: readonly TaskItem[],
  tasks: KernelContext['tasks'],
): Promise<FixTarget | null> {
  const vetoBody = releaseVetoBody(deps.runDir)
  if (vetoBody !== null) {
    const fallbackId = lastWalkedIdOf(tasks)
    const fallbackItem = fallbackId === null ? undefined : items.find((item) => item.id === fallbackId)
    if (fallbackItem === undefined) return null
    return { item: fallbackItem, failingTail: vetoTailOf(vetoBody), cause: 'veto' }
  }
  const logBody = await newestVerifyLog(deps.runDir)
  if (logBody === null) return null
  const failingTail = logBody.split('\n').slice(-30).join('\n')
  const failing = failingPathsOf(logBody)
  if (failing.size > 0) {
    const { stdout } = await deps.execGit(deps.cwd, ['log', '--name-only', '--format=@@%s'])
    for (const commit of parseSliceCommits(stdout)) {
      const item = items.find((candidate) => commit.subject.startsWith(candidate.text))
      if (item === undefined) continue
      if (commit.paths.some((commitPath) => failing.has(commitPath))) {
        return { item, failingTail, cause: 'verify' }
      }
    }
  }
  const fallbackId = lastWalkedIdOf(tasks)
  const fallbackItem = fallbackId === null ? undefined : items.find((item) => item.id === fallbackId)
  return fallbackItem === undefined ? null : { item: fallbackItem, failingTail, cause: 'verify' }
}
