import { LinearClient } from '@linear/sdk'

import { linearError } from '../errors.js'
import { logger } from '../logger.js'
import { classifyLinearError } from './classify-error.js'
import { requireEntity } from './response-guards.js'

const log = logger.child({ scope: 'linear:add-issue-comment' })

export async function addIssueComment({
  apiKey,
  issueId,
  body,
}: {
  apiKey: string
  issueId: string
  body: string
}): Promise<{ id: string; body: string; url: string }> {
  log.debug({ issueId, bodyLength: body.length }, 'addIssueComment called')

  try {
    const client = new LinearClient({ apiKey })
    const payload = await client.createComment({ issueId, body })
    const comment = requireEntity(await payload.comment, {
      entityName: 'comment',
      context: { issueId },
      appError: linearError.unknown(new Error('Linear API did not return comment after creation')),
    })
    log.info({ issueId, commentId: comment.id }, 'Comment added')
    return { id: comment.id, body: comment.body, url: comment.url }
  } catch (error) {
    log.error({ error: error instanceof Error ? error.message : String(error), issueId }, 'addIssueComment failed')
    throw classifyLinearError(error)
  }
}
