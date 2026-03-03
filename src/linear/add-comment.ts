import { LinearClient } from '@linear/sdk'

import { logger } from '../logger.js'
import { classifyLinearError } from './classify-error.js'

export async function addComment({
  apiKey,
  issueId,
  body,
}: {
  apiKey: string
  issueId: string
  body: string
}): Promise<{ id: string; body: string; url: string }> {
  logger.debug({ issueId, bodyLength: body.length }, 'addComment called')

  try {
    const client = new LinearClient({ apiKey })
    const payload = await client.createComment({ issueId, body })
    const comment = await payload.comment
    if (!comment) {
      throw new Error('No comment returned')
    }
    logger.info({ issueId, commentId: comment.id }, 'Comment added')
    return { id: comment.id, body: comment.body, url: comment.url }
  } catch (error) {
    logger.error({ error: error instanceof Error ? error.message : String(error), issueId }, 'addComment failed')
    throw classifyLinearError(error)
  }
}
