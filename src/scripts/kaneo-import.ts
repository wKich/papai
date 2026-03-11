import { z } from 'zod'

import { type KaneoConfig, KaneoLabelSchema, KaneoProjectSchema, KaneoTaskSchema, kaneoFetch } from '../kaneo/client.js'
import {
  CreateColumnBodySchema,
  CreateLabelBodySchema,
  CreateProjectBodySchema,
  CreateTaskBodySchema,
  UpdateProjectBodySchema,
} from '../kaneo/request-schemas.js'
import { logger } from '../logger.js'
import {
  assignLabels,
  buildRelations,
  ensureArchivedLabel,
  importComments,
  markArchived,
  patchRelations,
  type KaneoLabel,
} from './kaneo-import-helpers.js'
import type { LinearIssue, LinearLabel, LinearState } from './linear-client.js'
import { processWithAccumulator } from './queue.js'

const log = logger.child({ scope: 'kaneo-import' })

export { assignLabels, ensureArchivedLabel, markArchived, importComments, buildRelations, patchRelations }
export type { KaneoLabel }

const KaneoLabelSchemaLocal = KaneoLabelSchema.extend({
  taskId: z.string().nullish(),
})

const KaneoTaskWithDescriptionSchema = KaneoTaskSchema.extend({
  description: z.string(),
})

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
    CreateColumnBodySchema.parse({
      name: state.name,
      color: state.color,
      isFinal: state.type === 'completed' || state.type === 'canceled',
    }),
    undefined,
    KaneoColumnSchema,
  )
  return column.id
}

export interface EnsureColumnsResult {
  stateToColumnId: Map<string, string>
  newCount: number
}

export async function ensureColumns(
  config: KaneoConfig,
  projectId: string,
  states: LinearState[],
): Promise<EnsureColumnsResult> {
  const existing = await kaneoFetch(
    config,
    'GET',
    `/column/${projectId}`,
    undefined,
    undefined,
    z.array(KaneoColumnSchema),
  )
  const existingByName = new Map(existing.map((c) => [c.name.toLowerCase(), c.id]))

  return processWithAccumulator(
    states,
    { stateToColumnId: new Map<string, string>(), existingByName, newCount: 0 },
    async (state, acc) => {
      const normalizedName = state.name.toLowerCase()
      const isNew = !acc.existingByName.has(normalizedName)
      const columnId = await findOrCreateColumn(config, projectId, state, acc.existingByName)
      acc.stateToColumnId.set(state.name, columnId)
      acc.existingByName.set(normalizedName, columnId)
      if (isNew) acc.newCount++
      return acc
    },
  ).then(({ stateToColumnId, newCount }) => ({ stateToColumnId, newCount }))
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
    CreateLabelBodySchema.parse({ name: label.name, color: label.color, workspaceId }),
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

  return processWithAccumulator(
    linearLabels,
    { labelIdMap: new Map<string, string>(), existingByName },
    async (label, acc) => {
      const kaneoId = await findOrCreateLabel(config, workspaceId, label, acc.existingByName)
      acc.labelIdMap.set(label.id, kaneoId)
      acc.existingByName.set(label.name.toLowerCase(), kaneoId)
      return acc
    },
  ).then((acc) => acc.labelIdMap)
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
    CreateProjectBodySchema.parse({ name, workspaceId, icon: '', slug: generateSlug(name) }),
    undefined,
    KaneoProjectSchema,
  )

  if (description !== undefined && description.length > 0) {
    await kaneoFetch(
      config,
      'PUT',
      `/project/${project.id}`,
      UpdateProjectBodySchema.parse({ name, icon: '', slug: project.slug, description, isPublic: false }),
      undefined,
      KaneoProjectSchema,
    )
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
  archivedLabel: KaneoLabel | undefined,
): Promise<void> {
  const description = issue.description ?? ''

  const task = await kaneoFetch(
    config,
    'POST',
    `/task/${projectId}`,
    CreateTaskBodySchema.parse({
      title: issue.title,
      description,
      priority: mapPriority(issue.priority),
      status: issue.state.name,
      ...(issue.dueDate === null ? {} : { dueDate: issue.dueDate }),
    }),
    undefined,
    KaneoTaskWithDescriptionSchema,
  )

  linearIdToKaneoId.set(issue.id, task.id)
  log.info({ linearId: issue.identifier, kaneoId: task.id, title: issue.title }, 'Task created')

  await assignLabels(config, task.id, workspaceId, issue.labels.nodes, labelIdMap)

  if (issue.archivedAt !== null && archivedLabel !== undefined) {
    await markArchived(config, task.id, workspaceId, archivedLabel)
  }

  await importComments(config, task.id, issue.comments.nodes)
}
