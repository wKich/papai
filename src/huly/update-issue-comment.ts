import chunter, { type ChatMessage } from '@hcengineering/chunter'
import type { Ref, Space } from '@hcengineering/core'
import tracker, { type Issue } from '@hcengineering/tracker'

import { logger } from '../logger.js'
import { getHulyClient } from './huly-client.js'
import { ensureRef } from './refs.js'
import type { HulyClient } from './types.js'
import { fetchIssue } from './utils/fetchers.js'
import { buildIssueUrl } from './utils/url-builder.js'
import { withClient } from './utils/with-client.js'

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

async function findComment(client: HulyClient, commentId: Ref<ChatMessage>, issueId: Ref<Issue>): Promise<ChatMessage> {
  const comment = await client.findOne(chunter.class.ChatMessage, {
    _id: commentId,
    attachedTo: issueId,
  })

  if (comment === undefined || comment === null) {
    throw new Error(`Comment not found: ${commentId}`)
  }

  return comment
}

async function updateComment(
  client: HulyClient,
  projectId: Ref<Space>,
  commentId: Ref<ChatMessage>,
  issueId: Ref<Issue>,
  body: string,
): Promise<void> {
  await client.updateCollection(
    chunter.class.ChatMessage,
    projectId,
    commentId,
    issueId,
    tracker.class.Issue,
    'comments',
    { message: body, editedOn: Date.now() },
  )
}

export function updateIssueComment({
  userId,
  projectId,
  issueId,
  commentId,
  body,
}: UpdateIssueCommentParams): Promise<UpdateIssueCommentResult> {
  log.debug({ userId, projectId, issueId, commentId, bodyLength: body.length }, 'updateIssueComment called')

  return withClient(userId, getHulyClient, async (client) => {
    ensureRef<ChatMessage>(commentId)
    ensureRef<Space>(projectId)
    const issue = await fetchIssue(client, issueId)
    await findComment(client, commentId, issueId)
    await updateComment(client, projectId, commentId, issueId, body)
    const url = await buildIssueUrl(client, issue)

    log.info({ userId, issueId, commentId, identifier: issue.identifier }, 'Comment updated')

    return {
      id: commentId,
      body,
      url,
    }
  })
}
