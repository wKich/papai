import chunter, { type ChatMessage } from '@hcengineering/chunter'
import type { Ref, Space } from '@hcengineering/core'
import tracker, { type Issue } from '@hcengineering/tracker'

import { logger } from '../logger.js'
import { classifyHulyError } from './classify-error.js'
import { getHulyClient } from './huly-client.js'
import { ensureRef } from './refs.js'
import type { HulyClient } from './types.js'
import { buildIssueUrl } from './utils/url-builder.js'

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

async function verifyIssue(client: HulyClient, issueId: Ref<Issue>): Promise<Issue> {
  const result = await client.findOne(tracker.class.Issue, { _id: issueId })

  if (result === undefined || result === null) {
    throw new Error(`Issue not found: ${issueId}`)
  }
  return result
}

function addComment(
  client: HulyClient,
  projectId: Ref<Space>,
  issueId: Ref<Issue>,
  body: string,
): Promise<Ref<ChatMessage>> {
  return client.addCollection(chunter.class.ChatMessage, projectId, issueId, tracker.class.Issue, 'comments', {
    message: body,
    attachments: 0,
  })
}

export async function addIssueComment({
  userId,
  projectId,
  issueId,
  body,
}: AddIssueCommentParams): Promise<AddIssueCommentResult> {
  log.debug({ userId, projectId, issueId, bodyLength: body.length }, 'addIssueComment called')

  const client = await getHulyClient(userId)

  ensureRef<Issue>(issueId)
  ensureRef<Space>(projectId)

  try {
    const issue = await verifyIssue(client, issueId)
    const commentId = await addComment(client, projectId, issueId, body)
    const url = await buildIssueUrl(client, issue)

    log.info({ userId, issueId, commentId, identifier: issue.identifier }, 'Comment added to issue')

    return {
      id: commentId,
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
