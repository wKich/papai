import chunter, { type ChatMessage } from '@hcengineering/chunter'
import tracker, { type Issue } from '@hcengineering/tracker'

import { logger } from '../logger.js'
import { classifyHulyError } from './classify-error.js'
import { getHulyClient } from './huly-client.js'

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

export async function removeIssueComment({
  userId,
  projectId,
  issueId,
  commentId,
}: RemoveIssueCommentParams): Promise<RemoveIssueCommentResult> {
  log.debug({ userId, projectId, issueId, commentId }, 'removeIssueComment called')

  const client = await getHulyClient(userId)

  try {
    // First verify the issue exists
    const issue = (await client.findOne(tracker.class.Issue, {
      _id: issueId as unknown as Parameters<typeof client.findOne>[1]['_id'],
    } as unknown as Parameters<typeof client.findOne>[1])) as unknown as Issue | undefined

    if (!issue) {
      throw new Error(`Issue not found: ${issueId}`)
    }

    // Verify the comment exists and is attached to this issue
    const comment = (await client.findOne(chunter.class.ChatMessage, {
      _id: commentId as unknown as Parameters<typeof client.findOne>[1]['_id'],
      attachedTo: issueId as unknown as Parameters<typeof client.findOne>[1]['attachedTo'],
    } as unknown as Parameters<typeof client.findOne>[1])) as unknown as ChatMessage | undefined

    if (!comment) {
      throw new Error(`Comment not found: ${commentId}`)
    }

    // Remove comment using removeCollection
    await client.removeCollection(
      chunter.class.ChatMessage,
      projectId as unknown as Parameters<typeof client.removeCollection>[1],
      commentId as unknown as Parameters<typeof client.removeCollection>[2],
      issueId as unknown as Parameters<typeof client.removeCollection>[3],
      tracker.class.Issue,
      'comments',
    )

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
