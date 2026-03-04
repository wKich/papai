import { LinearClient } from '@linear/sdk'

import { linearError } from '../errors.js'
import { logger } from '../logger.js'
import { classifyLinearError } from './classify-error.js'
import { filterPresentNodes, requireEntity } from './response-guards.js'

const log = logger.child({ scope: 'linear:get-comments' })

export async function getComments({
  apiKey,
  issueId,
}: {
  apiKey: string
  issueId: string
}): Promise<{ id: string; body: string; createdAt: Date }[]> {
  log.debug({ issueId }, 'getComments called')

  try {
    const client = new LinearClient({ apiKey })
    const issue = requireEntity(await client.issue(issueId), {
      entityName: 'issue',
      context: { issueId },
      appError: linearError.issueNotFound(issueId),
    })
    const comments = await issue.comments()
    const result = filterPresentNodes(comments.nodes, { entityName: 'comment', parentId: issueId }).flatMap((c) => {
      const createdAt =
        c.createdAt instanceof Date
          ? c.createdAt
          : typeof c.createdAt === 'string' || typeof c.createdAt === 'number'
            ? new Date(c.createdAt)
            : undefined
      if (
        typeof c.id !== 'string' ||
        typeof c.body !== 'string' ||
        createdAt === undefined ||
        Number.isNaN(createdAt.getTime())
      ) {
        log.warn({ issueId, commentId: c.id }, 'Skipping comment with invalid response shape')
        return []
      }
      return [{ id: c.id, body: c.body, createdAt }]
    })
    log.info({ issueId, commentCount: result.length }, 'Comments fetched')
    return result
  } catch (error) {
    log.error({ error: error instanceof Error ? error.message : String(error), issueId }, 'getComments failed')
    throw classifyLinearError(error)
  }
}
