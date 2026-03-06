import chunter from '@hcengineering/chunter'
import tracker, { type Issue } from '@hcengineering/tracker'

import { logger } from '../logger.js'
import { classifyHulyError } from './classify-error.js'
import { getHulyClient } from './huly-client.js'

const log = logger.child({ scope: 'huly:add-issue-comment' })

export interface AddIssueCommentParams {
  userId: number
  projectId: string
  issueId: string
  body: string
}

export interface AddIssueCommentResult {
  id: string
  body: string
  url: string
}

export async function addIssueComment({
  userId,
  projectId,
  issueId,
  body,
}: AddIssueCommentParams): Promise<AddIssueCommentResult> {
  log.debug({ userId, projectId, issueId, bodyLength: body.length }, 'addIssueComment called')

  const client = await getHulyClient(userId)

  try {
    // First verify the issue exists
    const issue = (await client.findOne(tracker.class.Issue, {
      _id: issueId as unknown as Parameters<typeof client.findOne>[1]['_id'],
    } as unknown as Parameters<typeof client.findOne>[1])) as unknown as Issue | undefined

    if (!issue) {
      throw new Error(`Issue not found: ${issueId}`)
    }

    // Add comment using addCollection
    const commentId = await client.addCollection(
      chunter.class.ChatMessage,
      projectId as unknown as Parameters<typeof client.addCollection>[1],
      issueId as unknown as Parameters<typeof client.addCollection>[2],
      tracker.class.Issue,
      'comments',
      {
        message: body,
        attachments: 0,
      } as unknown as Parameters<typeof client.addCollection>[5],
    )

    log.info({ userId, issueId, commentId, identifier: issue.identifier }, 'Comment added to issue')

    // Construct URL
    const hulyUrl = process.env['HULY_URL'] ?? ''
    const hulyWorkspace = process.env['HULY_WORKSPACE'] ?? ''
    const project = (await client.findOne(tracker.class.Project, {
      _id: issue.space as unknown as Parameters<typeof client.findOne>[1]['_id'],
    } as unknown as Parameters<typeof client.findOne>[1])) as unknown as { identifier: string } | undefined
    const projectIdentifier = project?.identifier ?? 'UNK'
    const url = `${hulyUrl}/workbench/${hulyWorkspace}/tracker/${projectIdentifier}/${issue.identifier}`

    return {
      id: commentId as string,
      body,
      url,
    }
  } catch (error) {
    log.error(
      { error: error instanceof Error ? error.message : String(error), userId, issueId },
      'addIssueComment failed',
    )
    throw classifyHulyError(error)
  } finally {
    await client.close()
  }
}
