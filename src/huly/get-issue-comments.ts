import chunter, { type ChatMessage } from '@hcengineering/chunter'
import { type Issue } from '@hcengineering/tracker'

import { logger } from '../logger.js'
import { getHulyClient } from './huly-client.js'
import { ensureRef } from './refs.js'
import type { HulyClient } from './types.js'
import { fetchIssue } from './utils/fetchers.js'
import { withClient } from './utils/with-client.js'

const log = logger.child({ scope: 'huly:get-issue-comments' })

export interface GetIssueCommentsParams {
  userId: number
  issueId: string
}

export interface GetIssueCommentsResult {
  id: string
  body: string
  createdAt: Date
}

async function fetchComments(client: HulyClient, issueId: string): Promise<ChatMessage[]> {
  ensureRef<Issue>(issueId)
  const comments = await client.findAll(chunter.class.ChatMessage, { attachedTo: issueId })
  return comments
}

function isValidComment(comment: ChatMessage): boolean {
  if (typeof comment._id !== 'string' || typeof comment.message !== 'string') {
    log.warn({ commentId: comment._id }, 'Skipping comment with invalid response shape')
    return false
  }
  return true
}

function extractCreatedAt(comment: ChatMessage): Date {
  if (typeof comment.modifiedOn === 'number') {
    return new Date(comment.modifiedOn)
  }
  if (typeof comment.createdOn === 'number') {
    return new Date(comment.createdOn)
  }
  return new Date()
}

function mapComment(comment: ChatMessage): GetIssueCommentsResult {
  return {
    id: comment._id,
    body: comment.message,
    createdAt: extractCreatedAt(comment),
  }
}

export function getIssueComments({ userId, issueId }: GetIssueCommentsParams): Promise<GetIssueCommentsResult[]> {
  log.debug({ userId, issueId }, 'getIssueComments called')

  return withClient(userId, getHulyClient, async (client) => {
    await fetchIssue(client, issueId)
    const comments = await fetchComments(client, issueId)
    const result = comments.filter(isValidComment).map(mapComment)

    log.info({ userId, issueId, commentCount: result.length }, 'Comments fetched')
    return result
  })
}
