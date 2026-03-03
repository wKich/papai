import { LinearClient } from '@linear/sdk'

import { linearError } from '../errors.js'
import { logger } from '../logger.js'
import { classifyLinearError } from './classify-error.js'
import { filterPresentNodes, requireEntity } from './response-guards.js'

export async function getComments({
  apiKey,
  issueId,
}: {
  apiKey: string
  issueId: string
}): Promise<{ id: string; body: string; createdAt: Date }[]> {
  logger.debug({ issueId }, 'getComments called')

  try {
    const client = new LinearClient({ apiKey })
    const issue = requireEntity(await client.issue(issueId), {
      entityName: 'issue',
      context: { issueId },
      appError: linearError.issueNotFound(issueId),
    })
    const comments = await issue.comments()
    const result = filterPresentNodes(comments.nodes, { entityName: 'comment', parentId: issueId }).flatMap((c) => {
      const createdAt = c.createdAt instanceof Date ? c.createdAt : new Date(c.createdAt)
      if (typeof c.id !== 'string' || typeof c.body !== 'string' || Number.isNaN(createdAt.getTime())) {
        logger.warn({ issueId, commentId: c.id }, 'Skipping comment with invalid response shape')
        return []
      }
      return [{ id: c.id, body: c.body, createdAt }]
    })
    logger.info({ issueId, commentCount: result.length }, 'Comments fetched')
    return result
  } catch (error) {
    logger.error({ error: error instanceof Error ? error.message : String(error), issueId }, 'getComments failed')
    throw classifyLinearError(error)
  }
}
