import { z } from 'zod'

import { logger } from '../logger.js'
import { type KaneoConfig, kaneoFetch } from '../providers/kaneo/client.js'
import { mapPriority, type KaneoTask } from './kaneo-import.js'
import type { LinearIssue } from './linear-client.js'
import type { MigrationResult } from './test-migration-migrate.js'

const log = logger.child({ scope: 'test-migration:verify' })

export interface Check {
  name: string
  passed: boolean
  detail: string
}

function record(checks: Check[], name: string, passed: boolean, detail: string): void {
  checks.push({ name, passed, detail })
  const fn = passed ? 'info' : 'error'
  log[fn]({ check: name }, `${passed ? 'PASS' : 'FAIL'}: ${detail}`)
}

// Task schema for API responses
const KaneoTaskSchema = z.object({
  id: z.string(),
  title: z.string(),
  number: z.number(),
  status: z.string(),
  priority: z.string(),
})

const KaneoTaskWithStatusSchema = KaneoTaskSchema.extend({
  description: z.string(),
})

// Label schema for API responses
const KaneoLabelSchema = z.object({
  id: z.string(),
  name: z.string(),
  color: z.string(),
})

const KaneoLabelLocalSchema = KaneoLabelSchema.extend({
  taskId: z.string().nullish(),
})

// Project schema for API responses
const KaneoProjectSchema = z.object({
  id: z.string(),
  name: z.string(),
  slug: z.string(),
})

const getTask = (config: KaneoConfig, kaneoId: string): Promise<z.infer<typeof KaneoTaskWithStatusSchema>> =>
  kaneoFetch(config, 'GET', `/task/${kaneoId}`, undefined, undefined, KaneoTaskWithStatusSchema)

async function runSampleChecks(
  sample: LinearIssue[],
  idMap: Map<string, string>,
  checkFn: (issue: LinearIssue, kaneoId: string) => Promise<boolean>,
): Promise<{ verified: number }> {
  const results = await Promise.all(
    sample.map(async (issue) => {
      const kaneoId = idMap.get(issue.id)
      return kaneoId !== undefined && (await checkFn(issue, kaneoId))
    }),
  )
  return { verified: results.filter(Boolean).length }
}

export async function verifyPriorities(
  config: KaneoConfig,
  migration: MigrationResult,
  checks: Check[],
): Promise<void> {
  const sampleSize = Math.min(3, migration.linearIssues.length)
  if (sampleSize === 0) {
    record(checks, 'Task priorities match', true, 'No issues to verify (skipped)')
    return
  }
  const sample = migration.linearIssues.slice(0, sampleSize)
  const { verified } = await runSampleChecks(sample, migration.linearIdToKaneoId, async (issue, kaneoId) => {
    const task = await getTask(config, kaneoId)
    return (task as KaneoTask).priority === mapPriority(issue.priority)
  })
  record(
    checks,
    'Task priorities match',
    verified === sampleSize,
    `${verified}/${sampleSize} sampled tasks have correct priority`,
  )
}

function toColumnSlug(name: string): string {
  return name
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
}

export async function verifyTaskStatuses(
  config: KaneoConfig,
  migration: MigrationResult,
  checks: Check[],
): Promise<void> {
  const sampleSize = Math.min(5, migration.linearIssues.length)
  if (sampleSize === 0) {
    record(checks, 'Task statuses match column slugs', true, 'No issues to verify (skipped)')
    return
  }
  const sample = migration.linearIssues.slice(0, sampleSize)
  const { verified } = await runSampleChecks(sample, migration.linearIdToKaneoId, async (issue, kaneoId) => {
    const task = await getTask(config, kaneoId)
    const expectedSlug = toColumnSlug(issue.state.name)
    return task.status === expectedSlug
  })
  record(
    checks,
    'Task statuses match column slugs',
    verified === sampleSize,
    `${verified}/${sampleSize} sampled tasks have status matching their Linear state slug`,
  )
}

const ColumnWithTasksSchema = z.object({
  id: z.string(),
  name: z.string(),
  isFinal: z.boolean(),
  tasks: z.array(z.object({ id: z.string() })),
})

const ProjectBoardSchema = z.object({
  id: z.string(),
  columns: z.array(ColumnWithTasksSchema),
  archivedTasks: z.array(z.object({ id: z.string() })),
  plannedTasks: z.array(z.object({ id: z.string() })),
})

export async function verifyTasksInColumns(
  config: KaneoConfig,
  workspaceId: string,
  migration: MigrationResult,
  checks: Check[],
): Promise<void> {
  const projects = await kaneoFetch(config, 'GET', '/project', undefined, { workspaceId }, z.array(KaneoProjectSchema))
  const boards = await Promise.all(
    projects.map((project) =>
      kaneoFetch(config, 'GET', `/task/tasks/${project.id}`, undefined, undefined, ProjectBoardSchema).catch(
        () => null,
      ),
    ),
  )
  const tasksInColumns = new Set<string>()
  for (const board of boards) {
    if (board === null) continue
    for (const col of board.columns) {
      for (const t of col.tasks) tasksInColumns.add(t.id)
    }
    for (const t of board.plannedTasks) tasksInColumns.add(t.id)
  }
  const sampleSize = Math.min(5, migration.linearIdToKaneoId.size)
  const sampleIds = [...migration.linearIdToKaneoId.values()].slice(0, sampleSize)
  const found = sampleIds.filter((id) => tasksInColumns.has(id)).length
  record(
    checks,
    'Tasks visible in column board view',
    found === sampleSize,
    `${found}/${sampleSize} sampled migrated tasks appear in a column on the board`,
  )
}

export async function verifyWorkspaceLabels(
  config: KaneoConfig,
  workspaceId: string,
  migration: MigrationResult,
  checks: Check[],
): Promise<void> {
  const kaneoLabels = await kaneoFetch(
    config,
    'GET',
    `/label/workspace/${workspaceId}`,
    undefined,
    undefined,
    z.array(KaneoLabelLocalSchema),
  )
  const workspaceLabels = kaneoLabels.filter((l) => l.taskId === null)
  const hasArchivedIssues = migration.linearIssues.some((i) => i.archivedAt !== null)
  const linearHasArchivedLabel = migration.linearLabels.some((l) => l.name.toLowerCase() === 'archived')
  const expectedLabelCount = migration.linearLabels.length + (hasArchivedIssues && !linearHasArchivedLabel ? 1 : 0)
  record(
    checks,
    'Labels exist',
    workspaceLabels.length === expectedLabelCount,
    workspaceLabels.length === expectedLabelCount
      ? `All ${expectedLabelCount} labels present in workspace`
      : `Expected ${expectedLabelCount}, got ${workspaceLabels.length}`,
  )
}
