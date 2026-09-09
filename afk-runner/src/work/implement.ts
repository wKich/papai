// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

import { appendFile, readFile } from 'node:fs/promises'
import path from 'node:path'

import { z } from 'zod'

import { agentWritePath } from '../../../review-loop/src/agent-runner.js'
import type { AgentLayerDeps } from '../agent-layer.js'
import { runStageAgent } from '../agent-layer.js'
import { TASK_FIX_ATTEMPTS } from '../config.js'
import type { WorkIO } from '../drive/loop.js'
import type { KernelContext } from '../kernel/machine.js'
import { changeFolderPrefix } from '../write-guard.js'
import { fixTargetOf } from './fix-target.js'
import { AFFECTED_CHECK_COMMAND } from './run-check.js'
import type { RunCheckFn } from './run-check.js'
import { commitTaskSlice } from './slice-commit.js'
import { StageHaltError } from './stage-halt.js'
import { parseTaskItems } from './tasks-md.js'
import type { TaskItem } from './tasks-md.js'
import { newestVerifyLogPath } from './verify.js'

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
export const ImplementerReportSchema = z.object({
  files_written: z.array(z.string().min(1)).min(1),
})

/** The first item the walk still owes: unchecked in tasks.md and without a folded done record. */
export function firstOwedItem(items: readonly TaskItem[], tasks: KernelContext['tasks']): TaskItem | null {
  for (const item of items) {
    if (!item.checked && tasks[item.id]?.status !== 'done') return item
  }
  return null
}

/** The implement outcome reader (D4): an owed item re-enters implement; everything recorded done maps to verify — unless an unanswered red verdict owes a fix (D5). */
export function implementOutcomeOf(
  context: KernelContext,
  items: readonly TaskItem[],
  redVerdictOwed = false,
): 'outstanding' | 'done' {
  if (firstOwedItem(items, context.tasks) === null) return redVerdictOwed ? 'outstanding' : 'done'
  return 'outstanding'
}

/** The item-text detail bound (afk-runner-task-todos D1): the sanitizeRowGap/todo-content precedent. */
const MAX_TASK_DETAIL_CHARS = 200

/** The started event's detail: the item's tasks.md text collapsed to one line, truncated at the bound. */
export function taskStartedDetail(text: string): string {
  return text
    .replace(/[\r\n]+/gu, ' ')
    .trim()
    .slice(0, MAX_TASK_DETAIL_CHARS)
}

/** The spawn prompt: fresh work states the item; fix mode embeds the failing tail (D4) — a veto fix states the operator's redirect (D7). */
function spawnPromptOf(
  deps: ImplementDeps,
  input: ImplementInput,
  target: {
    readonly item: TaskItem
    readonly failingTail: string | null
    readonly cause: 'verify' | 'veto' | 'fresh'
  },
  basename: string,
): string {
  const reportLine = `Write your JSON report to ${agentWritePath(deps.cwd, basename)}: {"files_written": [<paths relative to the repo root>]}`
  const guardLines = [
    'Work test-first under the repo write protections; do not run git.',
    'Plan the item with the todo tool before editing; keep the todo list current as work proceeds.',
  ]
  if (target.failingTail === null) {
    return [
      `Implement exactly one task of the change ${input.changeName}:`,
      target.item.text,
      ...guardLines,
      reportLine,
    ].join('\n')
  }
  const causeLine =
    target.cause === 'veto'
      ? `Fix one task of the change ${input.changeName}: the operator vetoed the release of task ${target.item.id}.`
      : `Fix one task of the change ${input.changeName}: task ${target.item.id} broke the verification boundary.`
  const contextLines =
    target.cause === 'veto'
      ? ['The operator redirect to apply:', target.failingTail]
      : ['The failing verification output tail:', target.failingTail]
  return [causeLine, target.item.text, ...contextLines, ...guardLines, reportLine].join('\n')
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
 * The change folder's parsed task items. A missing or unreadable tasks.md is
 * a structural gap, not a code bug (walk-robustness F-P3): both strand the
 * walk's pick, so the read-catch escalates as `StageHaltError{precondition}`
 * with the restoration resume hint — mirroring `runAtomicity`'s exact shape.
 */
async function readTaskItems(cwd: string, changeName: string): Promise<readonly TaskItem[]> {
  const tasksPath = path.join(cwd, 'openspec', 'changes', changeName, 'tasks.md')
  let tasksMd: string
  try {
    tasksMd = await readFile(tasksPath, 'utf8')
  } catch (error) {
    throw new StageHaltError(
      `implement cannot read ${tasksPath}: ${error instanceof Error ? error.message : String(error)}`,
      'resume after the change folder is restored',
      'precondition',
    )
  }
  return parseTaskItems(tasksMd)
}

/** The target the bracket works: the first owed item fresh, or — nothing owed — the fix a red verdict or veto owes (D4/D5/D7). */
function pickTargetOf(
  deps: ImplementDeps,
  items: readonly TaskItem[],
  io: WorkIO,
): Promise<{
  readonly item: TaskItem
  readonly failingTail: string | null
  readonly cause: 'verify' | 'veto' | 'fresh'
} | null> {
  const owed = firstOwedItem(items, io.context.tasks)
  if (owed !== null) return Promise.resolve({ item: owed, failingTail: null, cause: 'fresh' })
  return fixTargetOf({ execGit: deps.agent.execGit, runDir: deps.runDir, cwd: deps.cwd }, items, io.context.tasks)
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
  const items = await readTaskItems(deps.cwd, input.changeName)
  const target = await pickTargetOf(deps, items, io)
  if (target === null) return
  const priorAttempts = io.context.tasks[target.item.id]?.attempts ?? 0
  if (priorAttempts >= TASK_FIX_ATTEMPTS) {
    throw new StageHaltError(
      `task ${target.item.id} exhausted its fix attempts (${TASK_FIX_ATTEMPTS}): ${target.item.text}`,
      're-target the item by hand or extend the budget through the escalation gate',
    )
  }
  const basename = `implement-t${target.item.id}.json`
  io.append({
    altitude: 'L2',
    type: 'task',
    action: 'started',
    id: target.item.id,
    detail: taskStartedDetail(target.item.text),
  })
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
  io.append({
    altitude: 'L2',
    type: 'task',
    action: 'done',
    id: target.item.id,
  })
  if (target.cause !== 'fresh') await answerFixedVerdict(deps, target.item.id, target.cause)
}

/**
 * A completed fix answers the artifact it re-read (D4/D5/D7): appending
 * past a red verdict — or past the veto redirect — makes the artifact's
 * last line no longer the open question, so the outcome reader stops owing
 * a fix and the boundary (or the release) re-runs.
 */
async function answerFixedVerdict(deps: ImplementDeps, id: string, cause: 'verify' | 'veto'): Promise<void> {
  const answerPath = cause === 'veto' ? path.join(deps.runDir, 'release-veto.md') : newestVerifyLogPath(deps.runDir)
  if (answerPath === null) return
  await appendFile(answerPath, `fix answered: task ${id}\n`)
}
