// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

import { existsSync } from 'node:fs'
import { mkdir, readFile } from 'node:fs/promises'
import path from 'node:path'

import { z } from 'zod'

export const AgentRoleSchema = z.enum([
  'drafter',
  'reviewer',
  'skeptic',
  'resolver',
  'estimator',
  'decomposer',
  'atomicity',
  'planner',
  'implementer',
])
export type AgentRole = z.infer<typeof AgentRoleSchema>

/**
 * Single-mode autonomy (D7): the ladder always evaluates and settles what it
 * can; there is no level switch anymore. `level` stays in the runtime shape
 * the gate prelude reads, pinned to `assist`.
 */
export interface AutonomyConfig {
  readonly level: 'assist'
  readonly costCeilingUsd: number | null
  readonly metered: boolean
  readonly deadlineMinutes?: number
}

/** Compiled timeout constants (the removed `timeouts` block's replacements). */
export const WALL_CLOCK_TIMEOUT_MS = 1_800_000
export const INACTIVITY_TIMEOUT_MS = 600_000

/** Structural plan-replan passes the planner agent gets before failing the run (D6). */
export const PLAN_REPLAN_PASSES = 1

/** Per-item fix attempts before implement declares exhaustion (U3 D4; a third `started` for one id refuses). */
export const TASK_FIX_ATTEMPTS = 2

const REMOVED_KEY_POINTERS: Readonly<Record<string, string>> = {
  autonomy: "replace with the top-level 'budget' and 'deadline' keys",
  models: "replace with the single top-level 'model'",
  timeouts: 'replaced by compiled timeout constants — remove the key',
  budgetUsd: "replace with the top-level 'budget' key",
}

const FiveKeySchema = z.object({
  repoRoot: z.string().min(1),
  workDir: z.string().min(1).default('.afk-runner'),
  model: z.string().min(1),
  budget: z.number().positive().nullable().default(5),
  deadline: z.number().positive().optional(),
  metered: z.boolean().optional(),
})

export const RunnerConfigSchema = z.strictObject({
  ...FiveKeySchema.shape,
})

/** Compiled launch defaults — the ladder's bottom rung (D1). */
export const DEFAULT_MODEL = 'opencode'
export const DEFAULT_BUDGET = 5
export const DEFAULT_WORK_DIR = '.afk-runner'

/**
 * The launch configuration ladder (D1-D5): a config file at
 * `<repoRoot>/<DEFAULT_WORK_DIR>/config.json` is wholesale-authoritative when
 * present (its five keys govern, `loadRunnerConfig` resolves and validates);
 * only file absence falls to the `AFK_RUNNER_MODEL` environment entry, and
 * unset entries fall to the compiled defaults.
 */
export async function resolveRunnerConfig(
  repoRoot: string,
  env: Record<string, string | undefined> = process.env,
): Promise<RunnerConfig> {
  const root = path.resolve(repoRoot)
  const configPath = path.join(root, DEFAULT_WORK_DIR, 'config.json')
  if (existsSync(configPath)) return loadRunnerConfig(configPath)
  const workDir = path.join(root, DEFAULT_WORK_DIR)
  await mkdir(workDir, { recursive: true })
  return {
    repoRoot: root,
    workDir,
    model: env['AFK_RUNNER_MODEL'] ?? DEFAULT_MODEL,
    budget: DEFAULT_BUDGET,
  }
}

export interface RunnerConfig {
  readonly repoRoot: string
  readonly workDir: string
  readonly model: string
  readonly budget: number | null
  readonly deadline?: number
  readonly metered?: boolean
}

export const AUTONOMY_DEFAULTS: AutonomyConfig = { level: 'assist', costCeilingUsd: 5, metered: true }

function removedKeyError(key: string): Error {
  const pointer = REMOVED_KEY_POINTERS[key] ?? 'not part of the five-key config — remove it'
  return new Error(`config key '${key}' was removed: ${pointer}`)
}

async function loadRaw(configPath: string): Promise<string> {
  try {
    return await readFile(configPath, 'utf8')
  } catch (error) {
    throw new Error(`runner config not found: ${configPath}`, { cause: error })
  }
}

export async function loadRunnerConfig(configPath: string): Promise<RunnerConfig> {
  const raw = await loadRaw(configPath)
  let json: unknown
  try {
    json = JSON.parse(raw)
  } catch (error) {
    throw new Error(`runner config invalid at ${configPath}: not valid JSON`, { cause: error })
  }
  if (typeof json === 'object' && json !== null && !Array.isArray(json)) {
    for (const key of Object.keys(json)) {
      if (key in REMOVED_KEY_POINTERS) throw removedKeyError(key)
    }
  }
  let parsed: z.infer<typeof RunnerConfigSchema>
  try {
    parsed = RunnerConfigSchema.parse(json)
  } catch (error) {
    const detail = error instanceof Error ? error.message : String(error)
    throw new Error(`runner config invalid at ${configPath}: ${detail}`, { cause: error })
  }
  const repoRoot = path.resolve(parsed.repoRoot)
  const workDir = path.resolve(repoRoot, parsed.workDir)
  await mkdir(workDir, { recursive: true })
  return { ...parsed, repoRoot, workDir }
}

/**
 * Effective autonomy derived from the five keys (single mode): the ladder
 * always runs; `budget` is the one cost ceiling, `deadline` the one wait.
 */
export function autonomyOf(config: RunnerConfig, deadlineMinutesOverride?: number): AutonomyConfig {
  return {
    level: 'assist',
    costCeilingUsd: config.budget,
    metered: config.metered ?? config.budget !== null,
    ...(deadlineMinutesOverride === undefined && config.deadline === undefined
      ? {}
      : { deadlineMinutes: deadlineMinutesOverride ?? config.deadline }),
  }
}

export function modelFor(config: RunnerConfig, _role: AgentRole): string {
  return config.model
}

/** Kebab-case slug transform shared by change names and child task files. */
export function slugify(input: string): string {
  return input
    .toLowerCase()
    .replace(/[^a-z0-9]+/gu, '-')
    .replace(/^-+|-+$/gu, '')
    .slice(0, 64)
    .replace(/-+$/u, '')
}

export function deriveChangeName(taskFileName: string, taskFileContent: string): string {
  const heading = taskFileContent.match(/^#\s+(.+)$/mu)?.[1]
  const base = heading ?? path.basename(taskFileName).replace(/\.[^.]*$/u, '')
  const slug = slugify(base)
  if (slug.length === 0) {
    throw new Error(`cannot derive a change name from task file ${taskFileName}`)
  }
  return slug
}

export type ExecGitFn = (cwd: string, args: readonly string[]) => Promise<{ stdout: string; stderr: string }>

export async function discoverBranch(execGit: ExecGitFn, repoRoot: string): Promise<string> {
  const { stdout } = await execGit(repoRoot, ['branch', '--show-current'])
  const branch = stdout.trim()
  if (branch.length === 0) {
    throw new Error('cannot discover the current branch (detached HEAD?) — report needs a branch git log')
  }
  return branch
}
