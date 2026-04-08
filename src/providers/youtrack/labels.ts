import { z } from 'zod'

import { logger } from '../../logger.js'
import type { Label } from '../types.js'
import { classifyYouTrackError } from './classify-error.js'
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
  try {
    const raw = await youtrackFetch(config, 'GET', '/api/tags', {
      query: { fields: TAG_FIELDS, $top: '100' },
    })
    const tags = TagSchema.array().parse(raw)
    log.info({ count: tags.length }, 'Tags listed')
    return tags.map((t) => ({ id: t.id, name: t.name, color: t.color?.background }))
  } catch (error) {
    log.error({ error: error instanceof Error ? error.message : String(error) }, 'Failed to list labels')
    throw classifyYouTrackError(error)
  }
}

export async function createYouTrackLabel(
  config: YouTrackConfig,
  params: { name: string; color?: string },
): Promise<Label> {
  log.debug({ name: params.name }, 'createLabel')
  try {
    const raw = await youtrackFetch(config, 'POST', '/api/tags', {
      body: { name: params.name },
      query: { fields: TAG_FIELDS },
    })
    const tag = TagSchema.parse(raw)
    log.info({ tagId: tag.id, name: tag.name }, 'Tag created')
    return { id: tag.id, name: tag.name, color: tag.color?.background }
  } catch (error) {
    log.error({ error: error instanceof Error ? error.message : String(error) }, 'Failed to create label')
    throw classifyYouTrackError(error)
  }
}

export async function updateYouTrackLabel(
  config: YouTrackConfig,
  labelId: string,
  params: { name?: string; color?: string },
): Promise<Label> {
  log.debug({ labelId }, 'updateLabel')
  try {
    const body: Record<string, unknown> = {}
    if (params.name !== undefined) body['name'] = params.name
    if (params.color !== undefined) {
      body['color'] = { background: params.color }
    }
    const raw = await youtrackFetch(config, 'POST', `/api/tags/${labelId}`, {
      body,
      query: { fields: TAG_FIELDS },
    })
    const tag = TagSchema.parse(raw)
    log.info({ tagId: tag.id }, 'Tag updated')
    return { id: tag.id, name: tag.name, color: tag.color?.background }
  } catch (error) {
    log.error({ error: error instanceof Error ? error.message : String(error), labelId }, 'Failed to update label')
    throw classifyYouTrackError(error, { labelId })
  }
}

export async function removeYouTrackLabel(config: YouTrackConfig, labelId: string): Promise<{ id: string }> {
  log.debug({ labelId }, 'removeLabel')
  try {
    await youtrackFetch(config, 'DELETE', `/api/tags/${labelId}`)
    log.info({ labelId }, 'Tag deleted')
    return { id: labelId }
  } catch (error) {
    log.error({ error: error instanceof Error ? error.message : String(error), labelId }, 'Failed to remove label')
    throw classifyYouTrackError(error, { labelId })
  }
}

export async function addYouTrackTaskLabel(
  config: YouTrackConfig,
  taskId: string,
  labelId: string,
): Promise<{ taskId: string; labelId: string }> {
  log.debug({ taskId, labelId }, 'addTaskLabel')
  try {
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
  } catch (error) {
    log.error(
      { error: error instanceof Error ? error.message : String(error), taskId, labelId },
      'Failed to add label to task',
    )
    throw classifyYouTrackError(error, { taskId, labelId })
  }
}

export async function removeYouTrackTaskLabel(
  config: YouTrackConfig,
  taskId: string,
  labelId: string,
): Promise<{ taskId: string; labelId: string }> {
  log.debug({ taskId, labelId }, 'removeTaskLabel')
  try {
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
  } catch (error) {
    log.error(
      { error: error instanceof Error ? error.message : String(error), taskId, labelId },
      'Failed to remove label from task',
    )
    throw classifyYouTrackError(error, { taskId, labelId })
  }
}
