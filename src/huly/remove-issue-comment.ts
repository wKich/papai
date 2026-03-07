import chunter, { type ChatMessage } from '@hcengineering/chunter'
import type { Ref, Space } from '@hcengineering/core'
import tracker, { type Issue } from '@hcengineering/tracker'

import { logger } from '../logger.js'
import { getHulyClient } from './huly-client.js'
import { ensureRef } from './refs.js'
import type { HulyClient } from './types.js'
import { fetchIssue } from './utils/fetchers.js'
import { withClient } from './utils/with-client.js'

const log = logger.child({ scope: 'huly:remove-issue-comment' })

export interface RemoveIssueCommentParams {
  userId: number
  projectId: string
  issueId: string
  commentId: string
}

export interface RemoveIssueCommentResult {
  id: string
  success: true
}

async function verifyCommentExists(
  client: HulyClient,
  commentId: Ref<ChatMessage>,
  issueId: Ref<Issue>,
): Promise<ChatMessage> {
  const comment = await client.findOne(chunter.class.ChatMessage, {
    _id: commentId,
    attachedTo: issueId,
  })

  if (comment === undefined || comment === null) {
    throw new Error(`Comment not found: ${commentId}`)
  }
  return comment
}

async function removeComment(
  client: HulyClient,
  projectId: Ref<Space>,
  commentId: Ref<ChatMessage>,
  issueId: Ref<Issue>,
): Promise<void> {
  await client.removeCollection(
    chunter.class.ChatMessage,
    projectId,
    commentId,
    issueId,
    tracker.class.Issue,
    'comments',
  )
}

export function removeIssueComment({
  userId,
  projectId,
  issueId,
  commentId,
}: RemoveIssueCommentParams): Promise<RemoveIssueCommentResult> {
  log.debug({ userId, projectId, issueId, commentId }, 'removeIssueComment called')

  return withClient(userId, getHulyClient, async (client) => {
    ensureRef<ChatMessage>(commentId)
    ensureRef<Space>(projectId)
    const issue = await fetchIssue(client, issueId)
    await verifyCommentExists(client, commentId, issueId)
    await removeComment(client, projectId, commentId, issueId)

    log.info({ userId, issueId, commentId, identifier: issue.identifier }, 'Comment removed')

    return { id: commentId, success: true }
  })
}
