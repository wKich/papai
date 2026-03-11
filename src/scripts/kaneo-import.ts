import { z } from 'zod'

import { type KaneoConfig, KaneoLabelSchema, KaneoProjectSchema, KaneoTaskSchema, kaneoFetch } from '../kaneo/client.js'
import { buildDescriptionWithRelations } from '../kaneo/frontmatter.js'
import { logger } from '../logger.js'
import { assignLabels, buildRelations, importComments, markArchived, patchRelations } from './kaneo-import-helpers.js'
import type { LinearIssue, LinearLabel, LinearState } from './linear-client.js'

const log = logger.child({ scope: 'kaneo-import' })

export { assignLabels, markArchived, importComments, buildRelations, patchRelations }

const KaneoLabelSchemaLocal = KaneoLabelSchema.extend({
  taskId: z.string().optional(),
})

const KaneoTaskWithDescriptionSchema = KaneoTaskSchema.extend({
  description: z.string(),
})

export type KaneoLabel = z.infer<typeof KaneoLabelSchemaLocal>
export type KaneoTask = z.infer<typeof KaneoTaskWithDescriptionSchema>

const KaneoColumnSchema = z.object({
  id: z.string(),
  name: z.string(),
})

export type KaneoProject = z.infer<typeof KaneoProjectSchema>

const LINEAR_PRIORITY_MAP: Record<number, string> = {
  0: 'no-priority',
  1: 'urgent',
  2: 'high',
  3: 'medium',
  4: 'low',
}

export function mapPriority(linearPriority: number): string {
  return LINEAR_PRIORITY_MAP[linearPriority] ?? 'no-priority'
}

async function findOrCreateColumn(
  config: KaneoConfig,
  projectId: string,
  state: LinearState,
  existingByName: Map<string, string>,
): Promise<string> {
  const normalizedName = state.name.toLowerCase()
  const existingId = existingByName.get(normalizedName)
  if (existingId !== undefined) return existingId

  log.info({ projectId, columnName: state.name, stateType: state.type }, 'Creating column')
  const column = await kaneoFetch(
    config,
    'POST',
    `/column/${projectId}`,
    { name: state.name, color: state.color, isFinal: state.type === 'completed' || state.type === 'canceled' },
    undefined,
    KaneoColumnSchema,
  )
  return column.id
}

export async function ensureColumns(
  config: KaneoConfig,
  projectId: string,
  states: LinearState[],
): Promise<Map<string, string>> {
  const existing = await kaneoFetch(
    config,
    'GET',
    `/column/${projectId}`,
    undefined,
    undefined,
    z.array(KaneoColumnSchema),
  )
  const existingByName = new Map(existing.map((c) => [c.name.toLowerCase(), c.id]))

  const stateToColumnId = new Map<string, string>()
  for (const state of states) {
    const columnId = await findOrCreateColumn(config, projectId, state, existingByName)
    stateToColumnId.set(state.name, columnId)
    existingByName.set(state.name.toLowerCase(), columnId)
  }
  return stateToColumnId
}

async function findOrCreateLabel(
  config: KaneoConfig,
  workspaceId: string,
  label: LinearLabel,
  existingByName: Map<string, string>,
): Promise<string> {
  const normalizedName = label.name.toLowerCase()
  const existingId = existingByName.get(normalizedName)
  if (existingId !== undefined) return existingId

  log.info({ workspaceId, labelName: label.name }, 'Creating label')
  const created = await kaneoFetch(
    config,
    'POST',
    '/label',
    { name: label.name, color: label.color, workspaceId },
    undefined,
    KaneoLabelSchemaLocal,
  )
  return created.id
}

export async function ensureLabels(
  config: KaneoConfig,
  workspaceId: string,
  linearLabels: LinearLabel[],
): Promise<Map<string, string>> {
  const existing = await kaneoFetch(
    config,
    'GET',
    `/label/workspace/${workspaceId}`,
    undefined,
    undefined,
    z.array(KaneoLabelSchemaLocal),
  )
  const existingByName = new Map(existing.map((l) => [l.name.toLowerCase(), l.id]))

  const labelIdMap = new Map<string, string>()
  for (const label of linearLabels) {
    const kaneoId = await findOrCreateLabel(config, workspaceId, label, existingByName)
    labelIdMap.set(label.id, kaneoId)
    existingByName.set(label.name.toLowerCase(), kaneoId)
  }
  return labelIdMap
}

function generateSlug(name: string): string {
  return name
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '')
}

export async function ensureProject(
  config: KaneoConfig,
  workspaceId: string,
  name: string,
  description?: string,
): Promise<string> {
  const existing = await kaneoFetch(config, 'GET', '/project', undefined, { workspaceId }, z.array(KaneoProjectSchema))
  const found = existing.find((p) => p.name.toLowerCase() === name.toLowerCase())
  if (found !== undefined) {
    log.info({ projectId: found.id, name }, 'Project already exists')
    return found.id
  }

  log.info({ workspaceId, name }, 'Creating project')
  const project = await kaneoFetch(
    config,
    'POST',
    '/project',
    { name, workspaceId, icon: '', slug: generateSlug(name) },
    undefined,
    KaneoProjectSchema,
  )

  if (description !== undefined && description.length > 0) {
    await kaneoFetch(config, 'PUT', `/project/${project.id}`, { description }, undefined, KaneoProjectSchema)
  }

  return project.id
}

export async function createTaskFromIssue(
  config: KaneoConfig,
  projectId: string,
  workspaceId: string,
  issue: LinearIssue,
  labelIdMap: Map<string, string>,
  linearIdToKaneoId: Map<string, string>,
): Promise<void> {
  const relations = buildRelations(issue, linearIdToKaneoId)
  const body = issue.description ?? ''
  const description = relations.length > 0 ? buildDescriptionWithRelations(body, relations) : body

  const task = await kaneoFetch(
    config,
    'POST',
    `/task/${projectId}`,
    {
      title: issue.title,
      description,
      priority: mapPriority(issue.priority),
      status: issue.state.name,
      dueDate: issue.dueDate,
    },
    undefined,
    KaneoTaskWithDescriptionSchema,
  )

  linearIdToKaneoId.set(issue.id, task.id)
  log.info({ linearId: issue.identifier, kaneoId: task.id, title: issue.title }, 'Task created')

  await assignLabels(config, task.id, workspaceId, issue.labels.nodes, labelIdMap)

  if (issue.archivedAt !== null) {
    await markArchived(config, task.id, workspaceId)
  }

  await importComments(config, task.id, issue.comments.nodes)
}
