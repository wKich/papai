import { providerError } from '../../errors.js'
import { logger } from '../../logger.js'
import { ProviderClassifiedError } from '../errors.js'
import type { RelationType } from '../types.js'
import type { YouTrackConfig } from './client.js'
import { youtrackFetch } from './client.js'
import { buildLinkCommand, buildRemoveLinkCommand } from './commands.js'
import { YtIssueLinksSchema } from './schemas/yt-types.js'

const log = logger.child({ scope: 'provider:youtrack:relations' })

export async function addYouTrackRelation(
  config: YouTrackConfig,
  taskId: string,
  relatedTaskId: string,
  type: RelationType,
): Promise<{ taskId: string; relatedTaskId: string; type: string }> {
  log.debug({ taskId, relatedTaskId, type }, 'addRelation')
  const command = buildLinkCommand(type, relatedTaskId)
  await youtrackFetch(config, 'POST', `/api/issues/${taskId}/execute`, {
    body: { query: command },
  })
  log.info({ taskId, relatedTaskId, type }, 'Relation added')
  return { taskId, relatedTaskId, type }
}

export async function removeYouTrackRelation(
  config: YouTrackConfig,
  taskId: string,
  relatedTaskId: string,
): Promise<{ taskId: string; relatedTaskId: string }> {
  log.debug({ taskId, relatedTaskId }, 'removeRelation')
  const raw = await youtrackFetch(config, 'GET', `/api/issues/${taskId}`, {
    query: { fields: 'id,links(id,direction,linkType(name),issues(id,idReadable))' },
  })
  const issue = YtIssueLinksSchema.parse(raw)
  const matchingLink = (issue.links ?? []).find((link) =>
    (link.issues ?? []).some((i) => i.id === relatedTaskId || i.idReadable === relatedTaskId),
  )
  if (matchingLink === undefined) {
    const err = providerError.relationNotFound(taskId, relatedTaskId)
    throw new ProviderClassifiedError(`Relation not found: ${taskId} -> ${relatedTaskId}`, err)
  }
  const typeName = matchingLink.linkType?.name ?? 'relates to'
  const removeCmd = buildRemoveLinkCommand(typeName, matchingLink.direction, relatedTaskId)
  await youtrackFetch(config, 'POST', `/api/issues/${taskId}/execute`, {
    body: { query: removeCmd },
  })
  log.info({ taskId, relatedTaskId }, 'Relation removed')
  return { taskId, relatedTaskId }
}
