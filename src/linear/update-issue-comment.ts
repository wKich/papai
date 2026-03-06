import { LinearClient } from '@linear/sdk'

import { linearError } from '../errors.js'
import { logger } from '../logger.js'
import { classifyHulyError } from './classify-error.js'
import { requireEntity } from './response-guards.js'

const log = logger.child({ scope: 'linear:update-issue-comment' })

export async function updateIssueComment({
  apiKey,
  commentId,
  body,
}: {
  apiKey: string
  commentId: string
  body: string
}): Promise<{ id: string; body: string; url: string }> {
  log.debug({ commentId, bodyLength: body.length }, 'updateIssueComment called')

  try {
    const client = new LinearClient({ apiKey })
    const payload = await client.updateComment(commentId, { body })
    const comment = requireEntity(await payload.comment, {
      entityName: 'comment',
      context: { commentId },
      appError: linearError.commentNotFound(commentId),
    })
    log.info({ commentId }, 'Comment updated')
    return { id: comment.id, body: comment.body, url: comment.url }
  } catch (error) {
    log.error({ error: error instanceof Error ? error.message : String(error), commentId }, 'updateIssueComment failed')
    throw classifyHulyError(error)
  }
}
