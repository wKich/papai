import { LinearClient } from '@linear/sdk'

import { logger } from '../logger.js'
import { classifyLinearError } from './classify-error.js'

const log = logger.child({ scope: 'linear:remove-issue-comment' })

export async function removeIssueComment({
  apiKey,
  commentId,
}: {
  apiKey: string
  commentId: string
}): Promise<{ id: string; success: true }> {
  log.debug({ commentId }, 'removeIssueComment called')

  try {
    const client = new LinearClient({ apiKey })
    await client.deleteComment(commentId)
    log.info({ commentId }, 'Comment removed')
    return { id: commentId, success: true }
  } catch (error) {
    log.error({ error: error instanceof Error ? error.message : String(error), commentId }, 'removeIssueComment failed')
    throw classifyLinearError(error)
  }
}
