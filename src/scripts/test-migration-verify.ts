import { z } from 'zod'

import { logger } from '../logger.js'
import { type KaneoConfig, kaneoFetch } from '../providers/kaneo/client.js'
import { parseRelationsFromDescription } from '../providers/kaneo/frontmatter.js'
import type { LinearIssue } from './linear-client.js'
import type { MigrationResult } from './test-migration-migrate.js'
import {
  type Check,
  verifyPriorities,
  verifyTaskStatuses,
  verifyTasksInColumns,
  verifyWorkspaceLabels,
} from './test-migration-verify-extra.js'

const log = logger.child({ scope: 'test-migration:verify' })

export interface VerificationResult {
  passed: boolean
  checks: Check[]
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

const KaneoTaskWithDescriptionSchema = KaneoTaskSchema.extend({
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

// Activity schema for API responses
const KaneoActivityWithTypeSchema = z.object({
  id: z.string(),
  type: z.string(),
  message: z.string().nullish(),
  createdAt: z.string().nullish(),
})

async function runSampleChecks(
  sample: LinearIssue[],
  idMap: Map<string, string>,
  checkFn: (issue: LinearIssue, kaneoId: string) => Promise<boolean>,
): Promise<{ verified: number; total: number }> {
  const results = await Promise.all(
    sample.map(async (issue) => {
      const kaneoId = idMap.get(issue.id)
      return kaneoId !== undefined && (await checkFn(issue, kaneoId))
    }),
  )
  return { verified: results.filter(Boolean).length, total: sample.length }
}

const getTask = (config: KaneoConfig, kaneoId: string): Promise<z.infer<typeof KaneoTaskWithDescriptionSchema>> =>
  kaneoFetch(config, 'GET', `/task/${kaneoId}`, undefined, undefined, KaneoTaskWithDescriptionSchema)

async function verifyProjects(
  config: KaneoConfig,
  workspaceId: string,
  migration: MigrationResult,
  checks: Check[],
): Promise<void> {
  const kaneoProjects = await kaneoFetch(
    config,
    'GET',
    '/project',
    undefined,
    { workspaceId },
    z.array(KaneoProjectSchema),
  )
  const expected = new Set(migration.linearProjects.map((p) => p.name))
  if (migration.linearIssues.some((i) => i.project === null)) expected.add('Inbox')
  const actual = new Set(kaneoProjects.map((p) => p.name))
  const missing = [...expected].filter((n) => !actual.has(n))
  record(
    checks,
    'Projects created',
    missing.length === 0,
    missing.length === 0 ? `All ${expected.size} projects exist` : `Missing: ${missing.join(', ')}`,
  )
}

async function verifyTasks(config: KaneoConfig, migration: MigrationResult, checks: Check[]): Promise<void> {
  const sampleSize = Math.min(5, migration.linearIssues.length)
  const sample = migration.linearIssues.slice(0, sampleSize)
  const { verified } = await runSampleChecks(sample, migration.linearIdToKaneoId, async (issue, kaneoId) => {
    const task = await getTask(config, kaneoId)
    return task.title === issue.title
  })
  record(
    checks,
    'Task titles match',
    verified === sampleSize,
    `${verified}/${sampleSize} sampled tasks have correct titles`,
  )
}

async function verifyRelations(config: KaneoConfig, migration: MigrationResult, checks: Check[]): Promise<void> {
  const withRelations = migration.linearIssues.filter((i) => i.relations.nodes.length > 0 || i.parent !== null)
  const sample = withRelations.slice(0, Math.min(3, withRelations.length))
  if (sample.length === 0) {
    record(checks, 'Relations in frontmatter', true, 'No issues with relations to verify (skipped)')
    return
  }
  const { verified } = await runSampleChecks(sample, migration.linearIdToKaneoId, async (_, kaneoId) => {
    const task = await getTask(config, kaneoId)
    return parseRelationsFromDescription(task.description).relations.length > 0
  })
  record(
    checks,
    'Relations in frontmatter',
    verified === sample.length,
    `${verified}/${sample.length} sampled tasks have frontmatter relations`,
  )
}

async function verifyParents(config: KaneoConfig, migration: MigrationResult, checks: Check[]): Promise<void> {
  const withParent = migration.linearIssues.filter((i) => i.parent !== null)
  const sample = withParent.slice(0, Math.min(3, withParent.length))
  if (sample.length === 0) {
    record(checks, 'Parent relations correct', true, 'No sub-issues to verify (skipped)')
    return
  }
  const { verified } = await runSampleChecks(sample, migration.linearIdToKaneoId, async (issue, kaneoId) => {
    const task = await getTask(config, kaneoId)
    const { relations } = parseRelationsFromDescription(task.description)
    const parentRel = relations.find((r) => r.type === 'parent')
    const expected = issue.parent === null ? undefined : migration.linearIdToKaneoId.get(issue.parent.id)
    return parentRel !== undefined && parentRel.taskId === expected
  })
  record(
    checks,
    'Parent relations correct',
    verified === sample.length,
    `${verified}/${sample.length} sub-issues have correct parent relation`,
  )
}

async function verifyArchived(
  config: KaneoConfig,
  issues: LinearIssue[],
  linearIdToKaneoId: Map<string, string>,
  checks: Check[],
): Promise<void> {
  const archived = issues.filter((i) => i.archivedAt !== null)
  if (archived.length === 0) {
    record(checks, 'Archived tasks labelled', true, 'No archived issues to verify (skipped)')
    return
  }
  const sample = archived.slice(0, Math.min(3, archived.length))
  const { verified: ok } = await runSampleChecks(sample, linearIdToKaneoId, async (_, kaneoId) => {
    const taskLabels = await kaneoFetch(
      config,
      'GET',
      `/label/task/${kaneoId}`,
      undefined,
      undefined,
      z.array(KaneoLabelLocalSchema),
    ).catch(() => [])
    return taskLabels.some((l) => l.name.toLowerCase() === 'archived')
  })
  record(
    checks,
    'Archived tasks labelled',
    ok === sample.length,
    `${ok}/${sample.length} archived tasks have "archived" label`,
  )
}

async function verifyComments(config: KaneoConfig, migration: MigrationResult, checks: Check[]): Promise<void> {
  const sample = migration.linearIssues.filter((i) => i.comments.nodes.length > 0).slice(0, 3)
  if (sample.length === 0) {
    record(checks, 'Comments imported', true, 'No issues with comments to verify (skipped)')
    return
  }
  const { verified } = await runSampleChecks(sample, migration.linearIdToKaneoId, async (issue, kaneoId) => {
    const activities = await kaneoFetch(
      config,
      'GET',
      `/activity/${kaneoId}`,
      undefined,
      undefined,
      z.array(KaneoActivityWithTypeSchema),
    ).catch(() => [])
    const comments = activities.filter((a) => a.type === 'comment' && a.message !== null && a.message !== undefined)
    return comments.length === issue.comments.nodes.length
  })
  record(
    checks,
    'Comments imported',
    verified === sample.length,
    `${verified}/${sample.length} sampled tasks have correct comment count`,
  )
}

async function verifyLabelAssignments(config: KaneoConfig, migration: MigrationResult, checks: Check[]): Promise<void> {
  const sample = migration.linearIssues.filter((i) => i.labels.nodes.length > 0).slice(0, 3)
  if (sample.length === 0) {
    record(checks, 'Label assignments', true, 'No labelled issues to verify (skipped)')
    return
  }
  const { verified } = await runSampleChecks(sample, migration.linearIdToKaneoId, async (issue, kaneoId) => {
    const taskLabels = await kaneoFetch(
      config,
      'GET',
      `/label/task/${kaneoId}`,
      undefined,
      undefined,
      z.array(KaneoLabelLocalSchema),
    ).catch(() => [])
    const assignedNames = new Set(taskLabels.map((l) => l.name.toLowerCase()))
    return issue.labels.nodes.every((l) => assignedNames.has(l.name.toLowerCase()))
  })
  record(
    checks,
    'Label assignments',
    verified === sample.length,
    `${verified}/${sample.length} sampled tasks have all expected labels`,
  )
}

export async function verify(
  kaneoConfig: KaneoConfig,
  workspaceId: string,
  migration: MigrationResult,
): Promise<VerificationResult> {
  const checks: Check[] = []

  record(
    checks,
    'All issues mapped',
    migration.linearIdToKaneoId.size === migration.linearIssues.length,
    `${migration.linearIdToKaneoId.size}/${migration.linearIssues.length} issues have Kaneo IDs`,
  )

  await verifyProjects(kaneoConfig, workspaceId, migration, checks)
  await verifyWorkspaceLabels(kaneoConfig, workspaceId, migration, checks)
  await verifyTasks(kaneoConfig, migration, checks)
  await verifyRelations(kaneoConfig, migration, checks)
  await verifyParents(kaneoConfig, migration, checks)
  await verifyArchived(kaneoConfig, migration.linearIssues, migration.linearIdToKaneoId, checks)
  await verifyComments(kaneoConfig, migration, checks)
  await verifyLabelAssignments(kaneoConfig, migration, checks)
  await verifyPriorities(kaneoConfig, migration, checks)
  await verifyTaskStatuses(kaneoConfig, migration, checks)
  await verifyTasksInColumns(kaneoConfig, workspaceId, migration, checks)

  return { passed: checks.every((c) => c.passed), checks }
}
