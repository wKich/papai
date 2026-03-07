import chunter, { type ChatMessage } from '@hcengineering/chunter'
import type { Ref, Space } from '@hcengineering/core'
import tracker, { type Issue } from '@hcengineering/tracker'

import { logger } from '../logger.js'
import { classifyHulyError } from './classify-error.js'
import { getHulyClient } from './huly-client.js'
import { ensureRef } from './refs.js'
import type { HulyClient } from './types.js'

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

async function verifyIssueExists(client: HulyClient, issueId: Ref<Issue>): Promise<Issue> {
  const issue = await client.findOne(tracker.class.Issue, { _id: issueId })

  if (issue === undefined || issue === null) {
    throw new Error(`Issue not found: ${issueId}`)
  }
  return issue
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

export async function removeIssueComment({
  userId,
  projectId,
  issueId,
  commentId,
}: RemoveIssueCommentParams): Promise<RemoveIssueCommentResult> {
  log.debug({ userId, projectId, issueId, commentId }, 'removeIssueComment called')

  const client = await getHulyClient(userId)

  ensureRef<Issue>(issueId)
  ensureRef<ChatMessage>(commentId)
  ensureRef<Space>(projectId)

  try {
    const issue = await verifyIssueExists(client, issueId)
    await verifyCommentExists(client, commentId, issueId)
    await removeComment(client, projectId, commentId, issueId)

    log.info({ userId, issueId, commentId, identifier: issue.identifier }, 'Comment removed')

    return { id: commentId, success: true }
  } catch (error) {
    log.error(
      { error: error instanceof Error ? error.message : String(error), userId, issueId, commentId },
      'removeIssueComment failed',
    )
    throw classifyHulyError(error)
  } finally {
    await client.close()
  }
}
