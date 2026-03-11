import { z } from 'zod'

import { type KaneoConfig, KaneoLabelSchema, kaneoFetch } from '../kaneo/client.js'
import {
  buildDescriptionWithRelations,
  parseRelationsFromDescription,
  type TaskRelation,
} from '../kaneo/frontmatter.js'
import { logger } from '../logger.js'
import type { LinearIssue, LinearLabel } from './linear-client.js'
import { processAndCount } from './queue.js'

const log = logger.child({ scope: 'kaneo-import-helpers' })

const KaneoLabelSchemaLocal = KaneoLabelSchema.extend({
  taskId: z.string().optional(),
})

const KaneoTaskWithDescriptionSchema = z.object({
  id: z.string(),
  title: z.string(),
  description: z.string(),
})

const KaneoActivitySchema = z.object({
  id: z.string(),
  comment: z.string(),
  createdAt: z.string(),
})

const RELATION_TYPE_MAP: Record<string, TaskRelation['type'] | undefined> = {
  blocks: 'blocks',
  blocked_by: 'blocked_by',
  duplicate: 'duplicate',
  duplicate_of: 'duplicate_of',
  related: 'related',
}

export async function assignLabels(
  config: KaneoConfig,
  taskId: string,
  workspaceId: string,
  issueLabels: LinearLabel[],
  labelIdMap: Map<string, string>,
): Promise<void> {
  const assignLabel = async (label: LinearLabel): Promise<void> => {
    const kaneoLabelId = labelIdMap.get(label.id)
    if (kaneoLabelId === undefined) return

    await kaneoFetch(
      config,
      'POST',
      '/label',
      {
        name: label.name,
        color: label.color,
        workspaceId,
        taskId,
      },
      undefined,
      KaneoLabelSchemaLocal,
    )
    log.debug({ taskId, labelName: label.name }, 'Label assigned to task')
  }

  await issueLabels.reduce<Promise<void>>(async (accPromise, label) => {
    await accPromise
    return assignLabel(label)
  }, Promise.resolve())
}

export type KaneoLabel = z.infer<typeof KaneoLabelSchemaLocal>

export async function ensureArchivedLabel(config: KaneoConfig, workspaceId: string): Promise<KaneoLabel> {
  const allLabels = await kaneoFetch(
    config,
    'GET',
    `/label/workspace/${workspaceId}`,
    undefined,
    undefined,
    z.array(KaneoLabelSchemaLocal),
  )
  const existing = allLabels.find((l) => l.name.toLowerCase() === 'archived')
  if (existing !== undefined) return existing

  log.info({ workspaceId }, 'Creating archived label')
  return kaneoFetch(
    config,
    'POST',
    '/label',
    { name: 'archived', color: '#808080', workspaceId },
    undefined,
    KaneoLabelSchemaLocal,
  )
}

export async function markArchived(
  config: KaneoConfig,
  taskId: string,
  workspaceId: string,
  archivedLabel: KaneoLabel,
): Promise<void> {
  await kaneoFetch(
    config,
    'POST',
    '/label',
    { name: archivedLabel.name, color: archivedLabel.color, workspaceId, taskId },
    undefined,
    KaneoLabelSchemaLocal,
  )
  log.debug({ taskId }, 'Task marked as archived')
}

export async function importComments(
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
      { taskId, comment: comment.body },
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

export function buildRelations(issue: LinearIssue, linearIdToKaneoId: Map<string, string>): TaskRelation[] {
  const relations: TaskRelation[] = []
  for (const rel of issue.relations.nodes) {
    if (!(rel.type in RELATION_TYPE_MAP)) {
      log.warn(
        {
          issueId: issue.identifier,
          relationType: rel.type,
        },
        'Unknown Linear relation type — skipped',
      )
    }
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

async function patchIssue(
  config: KaneoConfig,
  issue: LinearIssue,
  linearIdToKaneoId: Map<string, string>,
): Promise<boolean> {
  const kaneoTaskId = linearIdToKaneoId.get(issue.id)
  if (kaneoTaskId === undefined) return false

  const pendingRelations = buildRelations(issue, linearIdToKaneoId)
  if (pendingRelations.length === 0) return false

  const task = await kaneoFetch(
    config,
    'GET',
    `/task/${kaneoTaskId}`,
    undefined,
    undefined,
    KaneoTaskWithDescriptionSchema,
  )
  const { body: cleanBody } = parseRelationsFromDescription(task.description)
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
    return true
  }
  return false
}

export function patchRelations(
  config: KaneoConfig,
  issues: LinearIssue[],
  linearIdToKaneoId: Map<string, string>,
): Promise<number> {
  return processAndCount(issues, (issue) => patchIssue(config, issue, linearIdToKaneoId))
}
