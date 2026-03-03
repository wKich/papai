import { LinearClient } from '@linear/sdk'

import { logger } from '../logger.js'
import { classifyLinearError } from './classify-error.js'

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
    const issue = await client.issue(issueId)
    const comments = await issue.comments()
    const result = comments.nodes.map((c) => ({ id: c.id, body: c.body, createdAt: c.createdAt }))
    logger.info({ issueId, commentCount: result.length }, 'Comments fetched')
    return result
  } catch (error) {
    logger.error({ error: error instanceof Error ? error.message : String(error), issueId }, 'getComments failed')
    throw classifyLinearError(error)
  }
}
