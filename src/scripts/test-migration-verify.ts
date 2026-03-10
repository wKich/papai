import { z } from 'zod'

import { type KaneoConfig, KaneoLabelSchema, KaneoProjectSchema, KaneoTaskSchema, kaneoFetch } from '../kaneo/client.js'
import { parseRelationsFromDescription } from '../kaneo/frontmatter.js'
import { logger } from '../logger.js'
import type { LinearIssue } from './linear-client.js'
import type { MigrationResult } from './test-migration-migrate.js'

const log = logger.child({ scope: 'test-migration:verify' })

interface Check {
  name: string
  passed: boolean
  detail: string
}

export interface VerificationResult {
  passed: boolean
  checks: Check[]
}

function record(checks: Check[], name: string, passed: boolean, detail: string): void {
  checks.push({ name, passed, detail })
  const fn = passed ? 'info' : 'error'
  log[fn]({ check: name }, `${passed ? 'PASS' : 'FAIL'}: ${detail}`)
}

const KaneoTaskWithDescriptionSchema = KaneoTaskSchema.extend({
  description: z.string(),
})

const KaneoLabelLocalSchema = KaneoLabelSchema.extend({
  taskId: z.string().optional(),
})

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

  const checkTask = async (issue: LinearIssue): Promise<boolean> => {
    const kaneoId = migration.linearIdToKaneoId.get(issue.id)
    if (kaneoId === undefined) return false
    const task = await kaneoFetch(
      config,
      'GET',
      `/task/${kaneoId}`,
      undefined,
      undefined,
      KaneoTaskWithDescriptionSchema,
    )
    return task.title === issue.title
  }

  const results = await Promise.all(sample.map(checkTask))
  const matched = results.filter(Boolean).length

  record(
    checks,
    'Task titles match',
    matched === sampleSize,
    `${matched}/${sampleSize} sampled tasks have correct titles`,
  )
}

async function verifyRelations(config: KaneoConfig, migration: MigrationResult, checks: Check[]): Promise<void> {
  const withRelations = migration.linearIssues.filter((i) => i.relations.nodes.length > 0 || i.parent !== null)
  const sample = withRelations.slice(0, Math.min(3, withRelations.length))
  if (sample.length === 0) {
    record(checks, 'Relations in frontmatter', true, 'No issues with relations to verify (skipped)')
    return
  }

  const checkRelation = async (issue: LinearIssue): Promise<boolean> => {
    const kaneoId = migration.linearIdToKaneoId.get(issue.id)
    if (kaneoId === undefined) return false
    const task = await kaneoFetch(
      config,
      'GET',
      `/task/${kaneoId}`,
      undefined,
      undefined,
      KaneoTaskWithDescriptionSchema,
    )
    const { relations } = parseRelationsFromDescription(task.description)
    return relations.length > 0
  }

  const results = await Promise.all(sample.map(checkRelation))
  const verified = results.filter(Boolean).length

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

  const checkParent = async (issue: LinearIssue): Promise<boolean> => {
    const kaneoId = migration.linearIdToKaneoId.get(issue.id)
    if (kaneoId === undefined) return false
    const task = await kaneoFetch(
      config,
      'GET',
      `/task/${kaneoId}`,
      undefined,
      undefined,
      KaneoTaskWithDescriptionSchema,
    )
    const { relations } = parseRelationsFromDescription(task.description)
    const parentRel = relations.find((r) => r.type === 'parent')
    const expected = issue.parent === null ? undefined : migration.linearIdToKaneoId.get(issue.parent.id)
    return parentRel !== undefined && parentRel.taskId === expected
  }

  const results = await Promise.all(sample.map(checkParent))
  const verified = results.filter(Boolean).length

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

  const checkArchived = async (issue: LinearIssue): Promise<boolean> => {
    const kaneoId = linearIdToKaneoId.get(issue.id)
    if (kaneoId === undefined) return false
    const taskLabels = await kaneoFetch(
      config,
      'GET',
      `/label/task/${kaneoId}`,
      undefined,
      undefined,
      z.array(KaneoLabelLocalSchema),
    ).catch(() => [])
    return taskLabels.some((l) => l.name.toLowerCase() === 'archived')
  }

  const results = await Promise.all(sample.map(checkArchived))
  const ok = results.filter(Boolean).length

  record(
    checks,
    'Archived tasks labelled',
    ok === sample.length,
    `${ok}/${sample.length} archived tasks have "archived" label`,
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

  const kaneoLabels = await kaneoFetch(
    kaneoConfig,
    'GET',
    `/label/workspace/${workspaceId}`,
    undefined,
    undefined,
    z.array(KaneoLabelLocalSchema),
  )
  record(checks, 'Labels exist', kaneoLabels.length > 0, `${kaneoLabels.length} labels in workspace`)

  await verifyTasks(kaneoConfig, migration, checks)
  await verifyRelations(kaneoConfig, migration, checks)
  await verifyParents(kaneoConfig, migration, checks)
  await verifyArchived(kaneoConfig, migration.linearIssues, migration.linearIdToKaneoId, checks)

  return { passed: checks.every((c) => c.passed), checks }
}
