import { z } from 'zod'

import { logger } from '../../logger.js'
import type { Label } from '../types.js'
import type { YouTrackConfig } from './client.js'
import { youtrackFetch } from './client.js'
import { TAG_FIELDS } from './constants.js'
import { TagSchema } from './schemas/tag.js'

const IssueTagsSchema = z.object({
  id: z.string(),
  tags: z.array(z.object({ id: z.string() })).optional(),
})

const log = logger.child({ scope: 'provider:youtrack:labels' })

export async function listYouTrackLabels(config: YouTrackConfig): Promise<Label[]> {
  log.debug('listLabels')
  const raw = await youtrackFetch(config, 'GET', '/api/tags', {
    query: { fields: TAG_FIELDS, $top: '100' },
  })
  const tags = TagSchema.array().parse(raw)
  log.info({ count: tags.length }, 'Tags listed')
  return tags.map((t) => ({ id: t.id, name: t.name, color: t.color?.background }))
}

export async function createYouTrackLabel(
  config: YouTrackConfig,
  params: { name: string; color?: string },
): Promise<Label> {
  log.debug({ name: params.name }, 'createLabel')
  const raw = await youtrackFetch(config, 'POST', '/api/tags', {
    body: { name: params.name },
    query: { fields: TAG_FIELDS },
  })
  const tag = TagSchema.parse(raw)
  log.info({ tagId: tag.id, name: tag.name }, 'Tag created')
  return { id: tag.id, name: tag.name, color: tag.color?.background }
}

export async function updateYouTrackLabel(
  config: YouTrackConfig,
  labelId: string,
  params: { name?: string; color?: string },
): Promise<Label> {
  log.debug({ labelId }, 'updateLabel')
  const body: Record<string, unknown> = {}
  if (params.name !== undefined) body['name'] = params.name
  const raw = await youtrackFetch(config, 'POST', `/api/tags/${labelId}`, {
    body,
    query: { fields: TAG_FIELDS },
  })
  const tag = TagSchema.parse(raw)
  log.info({ tagId: tag.id }, 'Tag updated')
  return { id: tag.id, name: tag.name, color: tag.color?.background }
}

export async function removeYouTrackLabel(config: YouTrackConfig, labelId: string): Promise<{ id: string }> {
  log.debug({ labelId }, 'removeLabel')
  await youtrackFetch(config, 'DELETE', `/api/tags/${labelId}`)
  log.info({ labelId }, 'Tag deleted')
  return { id: labelId }
}

export async function addYouTrackTaskLabel(
  config: YouTrackConfig,
  taskId: string,
  labelId: string,
): Promise<{ taskId: string; labelId: string }> {
  log.debug({ taskId, labelId }, 'addTaskLabel')
  const raw = await youtrackFetch(config, 'GET', `/api/issues/${taskId}`, {
    query: { fields: 'id,tags(id)' },
  })
  const issue = IssueTagsSchema.parse(raw)
  const currentTagIds = (issue.tags ?? []).map((t) => ({ id: t.id }))
  currentTagIds.push({ id: labelId })
  await youtrackFetch(config, 'POST', `/api/issues/${taskId}`, {
    body: { tags: currentTagIds },
    query: { fields: 'id' },
  })
  log.info({ taskId, labelId }, 'Tag added to issue')
  return { taskId, labelId }
}

export async function removeYouTrackTaskLabel(
  config: YouTrackConfig,
  taskId: string,
  labelId: string,
): Promise<{ taskId: string; labelId: string }> {
  log.debug({ taskId, labelId }, 'removeTaskLabel')
  const raw = await youtrackFetch(config, 'GET', `/api/issues/${taskId}`, {
    query: { fields: 'id,tags(id)' },
  })
  const issue = IssueTagsSchema.parse(raw)
  const filteredTags = (issue.tags ?? []).filter((t) => t.id !== labelId).map((t) => ({ id: t.id }))
  await youtrackFetch(config, 'POST', `/api/issues/${taskId}`, {
    body: { tags: filteredTags },
    query: { fields: 'id' },
  })
  log.info({ taskId, labelId }, 'Tag removed from issue')
  return { taskId, labelId }
}
