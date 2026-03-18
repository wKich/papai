import { logger } from '../../logger.js'
import type { Label } from '../types.js'
import type { YouTrackConfig } from './client.js'
import { youtrackFetch } from './client.js'
import { TAG_FIELDS } from './constants.js'
import type { YtTag } from './types.js'

const log = logger.child({ scope: 'provider:youtrack:labels' })

export async function listYouTrackLabels(config: YouTrackConfig): Promise<Label[]> {
  log.debug('listLabels')
  const tags = await youtrackFetch<YtTag[]>(config, 'GET', '/api/tags', {
    query: { fields: TAG_FIELDS, $top: '100' },
  })
  log.info({ count: tags.length }, 'Tags listed')
  return tags.map((t) => ({ id: t.id, name: t.name, color: t.color?.background }))
}

export async function createYouTrackLabel(
  config: YouTrackConfig,
  params: { name: string; color?: string },
): Promise<Label> {
  log.debug({ name: params.name }, 'createLabel')
  const tag = await youtrackFetch<YtTag>(config, 'POST', '/api/tags', {
    body: { name: params.name },
    query: { fields: TAG_FIELDS },
  })
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
  const tag = await youtrackFetch<YtTag>(config, 'POST', `/api/tags/${labelId}`, {
    body,
    query: { fields: TAG_FIELDS },
  })
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
  const issue = await youtrackFetch<{ tags?: YtTag[] }>(config, 'GET', `/api/issues/${taskId}`, {
    query: { fields: 'id,tags(id)' },
  })
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
  const issue = await youtrackFetch<{ tags?: YtTag[] }>(config, 'GET', `/api/issues/${taskId}`, {
    query: { fields: 'id,tags(id)' },
  })
  const filteredTags = (issue.tags ?? []).filter((t) => t.id !== labelId).map((t) => ({ id: t.id }))
  await youtrackFetch(config, 'POST', `/api/issues/${taskId}`, {
    body: { tags: filteredTags },
    query: { fields: 'id' },
  })
  log.info({ taskId, labelId }, 'Tag removed from issue')
  return { taskId, labelId }
}
