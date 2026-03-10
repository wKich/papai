import { type KaneoConfig, kaneoFetch } from '../kaneo/client.js'
import { buildDescriptionWithRelations, type TaskRelation } from '../kaneo/frontmatter.js'
import { logger } from '../logger.js'
import type { LinearIssue, LinearLabel, LinearState } from './linear-client.js'

const log = logger.child({ scope: 'kaneo-import' })

export interface KaneoLabel {
  id: string
  name: string
  color: string
}

export interface KaneoTask {
  id: string
  title: string
  number: number
  status: string
  priority: string
  description: string
}

interface KaneoColumn {
  id: string
  name: string
}

interface KaneoProject {
  id: string
  name: string
  slug: string
}

interface KaneoActivity {
  id: string
  comment: string
  createdAt: string
}

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
  const existing = await kaneoFetch<KaneoColumn[]>(config, 'GET', `/column/${projectId}`)
  const existingByName = new Map(existing.map((c) => [c.name.toLowerCase(), c.id]))
  const stateToColumnId = new Map<string, string>()

  for (const state of states) {
    const normalizedName = state.name.toLowerCase()
    const existingId = existingByName.get(normalizedName)
    if (existingId !== undefined) {
      stateToColumnId.set(state.name, existingId)
      continue
    }

    log.info({ projectId, columnName: state.name, stateType: state.type }, 'Creating column')
    // Column creation must be sequential — order matters and we track IDs
    // eslint-disable-next-line no-await-in-loop
    const column = await kaneoFetch<KaneoColumn>(config, 'POST', `/column/${projectId}`, {
      name: state.name,
      color: state.color,
      isFinal: state.type === 'completed' || state.type === 'canceled',
    })
    stateToColumnId.set(state.name, column.id)
    existingByName.set(normalizedName, column.id)
  }

  return stateToColumnId
}

export async function ensureLabels(
  config: KaneoConfig,
  workspaceId: string,
  linearLabels: LinearLabel[],
): Promise<Map<string, string>> {
  const existing = await kaneoFetch<KaneoLabel[]>(config, 'GET', `/label/workspace/${workspaceId}`)
  const existingByName = new Map(existing.map((l) => [l.name.toLowerCase(), l.id]))
  const labelIdMap = new Map<string, string>()

  for (const label of linearLabels) {
    const normalizedName = label.name.toLowerCase()
    const existingId = existingByName.get(normalizedName)
    if (existingId !== undefined) {
      labelIdMap.set(label.id, existingId)
      continue
    }

    log.info({ workspaceId, labelName: label.name }, 'Creating label')
    // Label creation must be sequential — we track name→ID deduplication
    // eslint-disable-next-line no-await-in-loop
    const created = await kaneoFetch<KaneoLabel>(config, 'POST', '/label', {
      name: label.name,
      color: label.color,
      workspaceId,
    })
    labelIdMap.set(label.id, created.id)
    existingByName.set(normalizedName, created.id)
  }

  return labelIdMap
}

export async function ensureProject(
  config: KaneoConfig,
  workspaceId: string,
  name: string,
  description?: string,
): Promise<string> {
  const existing = await kaneoFetch<KaneoProject[]>(config, 'GET', '/project', undefined, { workspaceId })
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
  const project = await kaneoFetch<KaneoProject>(config, 'POST', '/project', {
    name,
    workspaceId,
    icon: '',
    slug,
  })

  if (description !== undefined && description.length > 0) {
    await kaneoFetch<KaneoProject>(config, 'PUT', `/project/${project.id}`, { description })
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
  for (const label of issueLabels) {
    const kaneoLabelId = labelIdMap.get(label.id)
    if (kaneoLabelId === undefined) continue
    // eslint-disable-next-line no-await-in-loop
    const labelDetail = await kaneoFetch<KaneoLabel>(config, 'GET', `/label/${kaneoLabelId}`)
    // eslint-disable-next-line no-await-in-loop
    await kaneoFetch<KaneoLabel>(config, 'POST', '/label', {
      name: labelDetail.name,
      color: labelDetail.color,
      workspaceId,
      taskId,
    })
    log.debug({ taskId, labelName: labelDetail.name }, 'Label assigned to task')
  }
}

async function markArchived(config: KaneoConfig, taskId: string, workspaceId: string): Promise<void> {
  const allLabels = await kaneoFetch<KaneoLabel[]>(config, 'GET', `/label/workspace/${workspaceId}`)
  const archiveLabel =
    allLabels.find((l) => l.name.toLowerCase() === 'archived') ??
    (await kaneoFetch<KaneoLabel>(config, 'POST', '/label', {
      name: 'archived',
      color: '#808080',
      workspaceId,
    }))

  await kaneoFetch<KaneoLabel>(config, 'POST', '/label', {
    name: archiveLabel.name,
    color: archiveLabel.color,
    workspaceId,
    taskId,
  })
  log.debug({ taskId }, 'Task marked as archived')
}

async function importComments(
  config: KaneoConfig,
  taskId: string,
  comments: LinearIssue['comments']['nodes'],
): Promise<void> {
  const sorted = [...comments].sort((a, b) => new Date(a.createdAt).getTime() - new Date(b.createdAt).getTime())
  for (const comment of sorted) {
    // eslint-disable-next-line no-await-in-loop
    await kaneoFetch<KaneoActivity>(config, 'POST', '/activity/comment', {
      taskId,
      comment: comment.body,
    })
    log.debug({ taskId, commentLength: comment.body.length }, 'Comment added')
  }
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

  const task = await kaneoFetch<KaneoTask>(config, 'POST', `/task/${projectId}`, {
    title: issue.title,
    description,
    priority: mapPriority(issue.priority),
    status: issue.state.name,
    dueDate: issue.dueDate,
  })

  linearIdToKaneoId.set(issue.id, task.id)
  log.info({ linearId: issue.identifier, kaneoId: task.id, title: issue.title }, 'Task created')

  await assignLabels(config, task.id, workspaceId, issue.labels.nodes, labelIdMap)

  if (issue.archivedAt !== null) {
    await markArchived(config, task.id, workspaceId)
  }

  await importComments(config, task.id, issue.comments.nodes)
}

export async function patchRelations(
  config: KaneoConfig,
  issues: LinearIssue[],
  linearIdToKaneoId: Map<string, string>,
): Promise<number> {
  let patched = 0

  for (const issue of issues) {
    const kaneoTaskId = linearIdToKaneoId.get(issue.id)
    if (kaneoTaskId === undefined) continue

    const pendingRelations = buildRelations(issue, linearIdToKaneoId)
    if (pendingRelations.length === 0) continue

    // eslint-disable-next-line no-await-in-loop
    const task = await kaneoFetch<KaneoTask>(config, 'GET', `/task/${kaneoTaskId}`)
    const cleanBody = task.description.replace(/^---\n[\s\S]*?\n---\n?/, '').trim()
    const expected = buildDescriptionWithRelations(cleanBody, pendingRelations)

    if (task.description !== expected) {
      // eslint-disable-next-line no-await-in-loop
      await kaneoFetch<KaneoTask>(config, 'PUT', `/task/description/${kaneoTaskId}`, { description: expected })
      patched++
      log.debug({ taskId: kaneoTaskId, relationCount: pendingRelations.length }, 'Relations patched')
    }
  }

  return patched
}
