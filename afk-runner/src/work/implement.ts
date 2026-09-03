// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

import { readdir, readFile } from 'node:fs/promises'
import path from 'node:path'

import { z } from 'zod'

import { agentWritePath } from '../../../review-loop/src/agent-runner.js'
import type { AgentLayerDeps } from '../agent-layer.js'
import { runStageAgent } from '../agent-layer.js'
import { TASK_FIX_ATTEMPTS } from '../config.js'
import type { WorkIO } from '../drive/loop.js'
import type { KernelContext } from '../kernel/machine.js'
import { changeFolderPrefix } from '../write-guard.js'
import { AFFECTED_CHECK_COMMAND } from './run-check.js'
import type { RunCheckFn } from './run-check.js'
import { commitTaskSlice } from './slice-commit.js'
import { StageHaltError } from './stage-halt.js'
import { parseTaskItems } from './tasks-md.js'
import type { TaskItem } from './tasks-md.js'

export interface ImplementDeps {
  readonly agent: AgentLayerDeps
  readonly runDir: string
  readonly sidecarDir: string
  readonly cwd: string
  readonly runCheck: RunCheckFn
}

export interface ImplementInput {
  readonly changeName: string
}

/** The implementer's report: the touched paths the per-task affected check narrows to. */
export const ImplementerReportSchema = z.object({ files_written: z.array(z.string().min(1)).min(1) })

/** The first item the walk still owes: unchecked in tasks.md and without a folded done record. */
export function firstOwedItem(items: readonly TaskItem[], tasks: KernelContext['tasks']): TaskItem | null {
  for (const item of items) {
    if (!item.checked && tasks[item.id]?.status !== 'done') return item
  }
  return null
}

/** The implement outcome reader (D4): an owed item re-enters implement; everything recorded done maps to verify. */
export function implementOutcomeOf(context: KernelContext, items: readonly TaskItem[]): 'outstanding' | 'done' {
  return firstOwedItem(items, context.tasks) === null ? 'done' : 'outstanding'
}

interface FixTarget {
  readonly item: TaskItem
  readonly failingTail: string
}

/** The newest verify boundary log in the run dir — fix context re-read from the run's own artifacts (D4 fix mode). */
async function newestVerifyLog(runDir: string): Promise<string | null> {
  let names: string[]
  try {
    names = await readdir(runDir)
  } catch {
    return null
  }
  const versions = names
    .map((name) => /^verify-(\d+)\.log$/u.exec(name))
    .filter((match): match is RegExpExecArray => match !== null)
    .map((match) => Number(match[1]))
  if (versions.length === 0) return null
  const newest = Math.max(...versions)
  try {
    return await readFile(path.join(runDir, `verify-${newest}.log`), 'utf8')
  } catch {
    return null
  }
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

/**
 * Fix mode (D4): with every item recorded done and a verify boundary log
 * present, re-target the culprit — the item whose runner-made slice commit
 * last touched a path the failing output names — falling back to the
 * last-walked id when nothing maps. The re-target re-emits `task started`
 * (last-state-wins flips the record to running; the attempt bound governs
 * thrash) and the spawn embeds the failing tail.
 */
async function fixTargetOf(
  deps: ImplementDeps,
  items: readonly TaskItem[],
  tasks: KernelContext['tasks'],
): Promise<FixTarget | null> {
  const logBody = await newestVerifyLog(deps.runDir)
  if (logBody === null) return null
  const failingTail = logBody.split('\n').slice(-30).join('\n')
  const failing = failingPathsOf(logBody)
  if (failing.size > 0) {
    const { stdout } = await deps.agent.execGit(deps.cwd, ['log', '--name-only', '--format=@@%s'])
    for (const commit of parseSliceCommits(stdout)) {
      const item = items.find((candidate) => commit.subject.startsWith(candidate.text))
      if (item === undefined) continue
      if (commit.paths.some((commitPath) => failing.has(commitPath))) {
        return { item, failingTail }
      }
    }
  }
  const fallbackId = lastWalkedIdOf(tasks)
  const fallbackItem = fallbackId === null ? undefined : items.find((item) => item.id === fallbackId)
  return fallbackItem === undefined ? null : { item: fallbackItem, failingTail }
}

/** The spawn prompt: fresh work states the item; fix mode embeds the failing verification tail (D4). */
function spawnPromptOf(
  deps: ImplementDeps,
  input: ImplementInput,
  target: { readonly item: TaskItem; readonly failingTail: string | null },
  basename: string,
): string {
  const reportLine = `Write your JSON report to ${agentWritePath(deps.cwd, basename)}: {"files_written": [<paths relative to the repo root>]}`
  const guardLines = ['Work test-first under the repo write protections; do not run git.']
  if (target.failingTail === null) {
    return [
      `Implement exactly one task of the change ${input.changeName}:`,
      target.item.text,
      ...guardLines,
      reportLine,
    ].join('\n')
  }
  return [
    `Fix one task of the change ${input.changeName}: task ${target.item.id} broke the verification boundary.`,
    target.item.text,
    'The failing verification output tail:',
    target.failingTail,
    ...guardLines,
    reportLine,
  ].join('\n')
}

/** The per-task affected check: green continues; red records `task failed` with the output tail and stops the item. */
async function runAffectedCheck(deps: ImplementDeps, io: WorkIO, item: TaskItem): Promise<'green' | 'red'> {
  const check = await deps.runCheck(deps.cwd, AFFECTED_CHECK_COMMAND)
  if (check.exitCode === 0) return 'green'
  const tail = [...check.stdout.split('\n'), ...check.stderr.split('\n')].filter((line) => line.length > 0)
  io.append({
    altitude: 'L2',
    type: 'task',
    action: 'failed',
    id: item.id,
    detail: tail.slice(-8).join('\n'),
  })
  return 'red'
}

/**
 * One walked item per work bracket (U3 D4): append `task started`, spawn the
 * implementer (role `implementer`, label/round keyed by the item id so the
 * session-ledger continuation keys per task), run the per-task affected
 * check, and on green let the runner commit the slice — the checked box and
 * the work in one commit — before `task done`. A red check records
 * `task failed` and commits nothing; the self-successor re-entry re-picks
 * the item under the attempt bound. The drive loop's self-successor
 * re-enters for the next item; resume skip-forward is the same rule —
 * items whose done the fold records are never re-picked.
 */
export async function runImplementWork(deps: ImplementDeps, input: ImplementInput, io: WorkIO): Promise<void> {
  const changeDir = path.join(deps.cwd, 'openspec', 'changes', input.changeName)
  const tasksPath = path.join(changeDir, 'tasks.md')
  let tasksMd: string
  try {
    tasksMd = await readFile(tasksPath, 'utf8')
  } catch (error) {
    throw new Error(`implement cannot read ${tasksPath}: ${error instanceof Error ? error.message : String(error)}`, {
      cause: error,
    })
  }
  const items = parseTaskItems(tasksMd)
  const owed = firstOwedItem(items, io.context.tasks)
  const target = owed === null ? await fixTargetOf(deps, items, io.context.tasks) : { item: owed, failingTail: null }
  if (target === null) return
  const priorAttempts = io.context.tasks[target.item.id]?.attempts ?? 0
  if (priorAttempts >= TASK_FIX_ATTEMPTS) {
    throw new StageHaltError(
      `task ${target.item.id} exhausted its fix attempts (${TASK_FIX_ATTEMPTS}): ${target.item.text}`,
      're-target the item by hand or extend the budget through the escalation gate',
    )
  }
  const basename = `implement-t${target.item.id}.json`
  io.append({ altitude: 'L2', type: 'task', action: 'started', id: target.item.id })
  await runStageAgent(deps.agent, {
    role: 'implementer',
    changeName: input.changeName,
    cwd: deps.cwd,
    prompt: spawnPromptOf(deps, input, target, basename),
    outputPath: basename,
    outputSchema: ImplementerReportSchema,
    label: `implement-t${target.item.id}`,
    runDir: deps.runDir,
    round: Number(target.item.id),
    sidecarDir: deps.sidecarDir,
    guard: {
      allowedPrefix: changeFolderPrefix(input.changeName),
      allowedExcept: ['openspec/changes/'],
    },
  })
  if ((await runAffectedCheck(deps, io, target.item)) === 'red') return
  await commitTaskSlice({ execGit: deps.agent.execGit, cwd: deps.cwd, changeDir }, target.item)
  io.append({ altitude: 'L2', type: 'task', action: 'done', id: target.item.id })
}
