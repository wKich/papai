import chunter, { type ChatMessage } from '@hcengineering/chunter'
import tracker, { type Issue } from '@hcengineering/tracker'

import { logger } from '../logger.js'
import { classifyHulyError } from './classify-error.js'
import { getHulyClient } from './huly-client.js'

const log = logger.child({ scope: 'huly:update-issue-comment' })

export interface UpdateIssueCommentParams {
  userId: number
  projectId: string
  issueId: string
  commentId: string
  body: string
}

export interface UpdateIssueCommentResult {
  id: string
  body: string
  url: string
}

export async function updateIssueComment({
  userId,
  projectId,
  issueId,
  commentId,
  body,
}: UpdateIssueCommentParams): Promise<UpdateIssueCommentResult> {
  log.debug({ userId, projectId, issueId, commentId, bodyLength: body.length }, 'updateIssueComment called')

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

    // Update comment using updateCollection
    await client.updateCollection(
      chunter.class.ChatMessage,
      projectId as unknown as Parameters<typeof client.updateCollection>[1],
      commentId as unknown as Parameters<typeof client.updateCollection>[2],
      issueId as unknown as Parameters<typeof client.updateCollection>[3],
      tracker.class.Issue,
      'comments',
      {
        message: body,
        editedOn: Date.now(),
      } as unknown as Parameters<typeof client.updateCollection>[6],
    )

    log.info({ userId, issueId, commentId, identifier: issue.identifier }, 'Comment updated')

    // Construct URL
    const hulyUrl = process.env['HULY_URL'] ?? ''
    const hulyWorkspace = process.env['HULY_WORKSPACE'] ?? ''
    const project = (await client.findOne(tracker.class.Project, {
      _id: issue.space as unknown as Parameters<typeof client.findOne>[1]['_id'],
    } as unknown as Parameters<typeof client.findOne>[1])) as unknown as { identifier: string } | undefined
    const projectIdentifier = project?.identifier ?? 'UNK'
    const url = `${hulyUrl}/workbench/${hulyWorkspace}/tracker/${projectIdentifier}/${issue.identifier}`

    return {
      id: commentId,
      body,
      url,
    }
  } catch (error) {
    log.error(
      { error: error instanceof Error ? error.message : String(error), userId, issueId, commentId },
      'updateIssueComment failed',
    )
    throw classifyHulyError(error)
  } finally {
    await client.close()
  }
}
