import { z } from 'zod'

import { type KaneoConfig, KaneoLabelSchema, KaneoProjectSchema, KaneoTaskSchema, kaneoFetch } from '../kaneo/client.js'
import { buildDescriptionWithRelations, type TaskRelation } from '../kaneo/frontmatter.js'
import { logger } from '../logger.js'
import type { LinearIssue, LinearLabel, LinearState } from './linear-client.js'

const log = logger.child({ scope: 'kaneo-import' })

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

const KaneoActivitySchema = z.object({
  id: z.string(),
  comment: z.string(),
  createdAt: z.string(),
})

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

const RELATION_TYPE_MAP: Record<string, TaskRelation['type'] | undefined> = {
  blocks: 'blocks',
  duplicate: 'duplicate',
  related: 'related',
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

  const processState = async (
    accumulator: { stateToColumnId: Map<string, string>; existingByName: Map<string, string> },
    state: LinearState,
  ): Promise<{ stateToColumnId: Map<string, string>; existingByName: Map<string, string> }> => {
    const normalizedName = state.name.toLowerCase()
    const existingId = accumulator.existingByName.get(normalizedName)
    if (existingId !== undefined) {
      return {
        stateToColumnId: new Map([...accumulator.stateToColumnId, [state.name, existingId]]),
        existingByName: accumulator.existingByName,
      }
    }

    log.info({ projectId, columnName: state.name, stateType: state.type }, 'Creating column')
    const column = await kaneoFetch(
      config,
      'POST',
      `/column/${projectId}`,
      {
        name: state.name,
        color: state.color,
        isFinal: state.type === 'completed' || state.type === 'canceled',
      },
      undefined,
      KaneoColumnSchema,
    )
    return {
      stateToColumnId: new Map([...accumulator.stateToColumnId, [state.name, column.id]]),
      existingByName: new Map([...accumulator.existingByName, [normalizedName, column.id]]),
    }
  }

  const initial = { stateToColumnId: new Map<string, string>(), existingByName }
  const result = await states.reduce<Promise<typeof initial>>(async (accPromise, state) => {
    const acc = await accPromise
    return processState(acc, state)
  }, Promise.resolve(initial))

  return result.stateToColumnId
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

  const processLabel = async (
    accumulator: { labelIdMap: Map<string, string>; existingByName: Map<string, string> },
    label: LinearLabel,
  ): Promise<{ labelIdMap: Map<string, string>; existingByName: Map<string, string> }> => {
    const normalizedName = label.name.toLowerCase()
    const existingId = accumulator.existingByName.get(normalizedName)
    if (existingId !== undefined) {
      return {
        labelIdMap: new Map([...accumulator.labelIdMap, [label.id, existingId]]),
        existingByName: accumulator.existingByName,
      }
    }

    log.info({ workspaceId, labelName: label.name }, 'Creating label')
    const created = await kaneoFetch(
      config,
      'POST',
      '/label',
      {
        name: label.name,
        color: label.color,
        workspaceId,
      },
      undefined,
      KaneoLabelSchemaLocal,
    )
    return {
      labelIdMap: new Map([...accumulator.labelIdMap, [label.id, created.id]]),
      existingByName: new Map([...accumulator.existingByName, [normalizedName, created.id]]),
    }
  }

  const initial = { labelIdMap: new Map<string, string>(), existingByName }
  const result = await linearLabels.reduce<Promise<typeof initial>>(async (accPromise, label) => {
    const acc = await accPromise
    return processLabel(acc, label)
  }, Promise.resolve(initial))

  return result.labelIdMap
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

  const slug = name
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '')

  log.info({ workspaceId, name }, 'Creating project')
  const project = await kaneoFetch(
    config,
    'POST',
    '/project',
    {
      name,
      workspaceId,
      icon: '',
      slug,
    },
    undefined,
    KaneoProjectSchema,
  )

  if (description !== undefined && description.length > 0) {
    await kaneoFetch(config, 'PUT', `/project/${project.id}`, { description }, undefined, KaneoProjectSchema)
  }

  return project.id
}

async function assignLabels(
  config: KaneoConfig,
  taskId: string,
  workspaceId: string,
  issueLabels: LinearLabel[],
  labelIdMap: Map<string, string>,
): Promise<void> {
  const assignLabel = async (label: LinearLabel): Promise<void> => {
    const kaneoLabelId = labelIdMap.get(label.id)
    if (kaneoLabelId === undefined) return

    const labelDetail = await kaneoFetch(
      config,
      'GET',
      `/label/${kaneoLabelId}`,
      undefined,
      undefined,
      KaneoLabelSchemaLocal,
    )
    await kaneoFetch(
      config,
      'POST',
      '/label',
      {
        name: labelDetail.name,
        color: labelDetail.color,
        workspaceId,
        taskId,
      },
      undefined,
      KaneoLabelSchemaLocal,
    )
    log.debug({ taskId, labelName: labelDetail.name }, 'Label assigned to task')
  }

  await issueLabels.reduce<Promise<void>>(async (accPromise, label) => {
    await accPromise
    return assignLabel(label)
  }, Promise.resolve())
}

async function markArchived(config: KaneoConfig, taskId: string, workspaceId: string): Promise<void> {
  const allLabels = await kaneoFetch(
    config,
    'GET',
    `/label/workspace/${workspaceId}`,
    undefined,
    undefined,
    z.array(KaneoLabelSchemaLocal),
  )
  const archiveLabel =
    allLabels.find((l) => l.name.toLowerCase() === 'archived') ??
    (await kaneoFetch(
      config,
      'POST',
      '/label',
      {
        name: 'archived',
        color: '#808080',
        workspaceId,
      },
      undefined,
      KaneoLabelSchemaLocal,
    ))

  await kaneoFetch(
    config,
    'POST',
    '/label',
    {
      name: archiveLabel.name,
      color: archiveLabel.color,
      workspaceId,
      taskId,
    },
    undefined,
    KaneoLabelSchemaLocal,
  )
  log.debug({ taskId }, 'Task marked as archived')
}

async function importComments(
  config: KaneoConfig,
  taskId: string,
  comments: LinearIssue['comments']['nodes'],
): Promise<void> {
  const sorted = [...comments].sort((a, b) => new Date(a.createdAt).getTime() - new Date(b.createdAt).getTime())

  const importComment = async (comment: LinearIssue['comments']['nodes'][number]): Promise<void> => {
    await kaneoFetch(
      config,
      'POST',
      '/activity/comment',
      {
        taskId,
        comment: comment.body,
      },
      undefined,
      KaneoActivitySchema,
    )
    log.debug({ taskId, commentLength: comment.body.length }, 'Comment added')
  }

  await sorted.reduce<Promise<void>>(async (accPromise, comment) => {
    await accPromise
    return importComment(comment)
  }, Promise.resolve())
}

function buildRelations(issue: LinearIssue, linearIdToKaneoId: Map<string, string>): TaskRelation[] {
  const relations: TaskRelation[] = []
  for (const rel of issue.relations.nodes) {
    const type = RELATION_TYPE_MAP[rel.type]
    if (type === undefined) continue
    const kaneoRelatedId = linearIdToKaneoId.get(rel.relatedIssue.id)
    if (kaneoRelatedId !== undefined) {
      relations.push({ type, taskId: kaneoRelatedId })
    }
  }

  if (issue.parent !== null) {
    const kaneoParentId = linearIdToKaneoId.get(issue.parent.id)
    if (kaneoParentId !== undefined) {
      relations.push({ type: 'parent', taskId: kaneoParentId })
    }
  }

  return relations
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

export function patchRelations(
  config: KaneoConfig,
  issues: LinearIssue[],
  linearIdToKaneoId: Map<string, string>,
): Promise<number> {
  const processIssue = async (patched: number, issue: LinearIssue): Promise<number> => {
    const kaneoTaskId = linearIdToKaneoId.get(issue.id)
    if (kaneoTaskId === undefined) return patched

    const pendingRelations = buildRelations(issue, linearIdToKaneoId)
    if (pendingRelations.length === 0) return patched

    const task = await kaneoFetch(
      config,
      'GET',
      `/task/${kaneoTaskId}`,
      undefined,
      undefined,
      KaneoTaskWithDescriptionSchema,
    )
    const cleanBody = task.description.replace(/^---\n[\s\S]*?\n---\n?/, '').trim()
    const expected = buildDescriptionWithRelations(cleanBody, pendingRelations)

    if (task.description !== expected) {
      await kaneoFetch(
        config,
        'PUT',
        `/task/description/${kaneoTaskId}`,
        { description: expected },
        undefined,
        KaneoTaskWithDescriptionSchema,
      )
      log.debug({ taskId: kaneoTaskId, relationCount: pendingRelations.length }, 'Relations patched')
      return patched + 1
    }
    return patched
  }

  return issues.reduce<Promise<number>>(async (accPromise, issue) => {
    const acc = await accPromise
    return processIssue(acc, issue)
  }, Promise.resolve(0))
}
