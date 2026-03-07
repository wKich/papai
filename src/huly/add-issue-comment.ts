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

export function addIssueComment({
  userId,
  projectId,
  issueId,
  body,
}: AddIssueCommentParams): Promise<AddIssueCommentResult> {
  log.debug({ userId, projectId, issueId, bodyLength: body.length }, 'addIssueComment called')

  return withClient(userId, getHulyClient, async (client) => {
    ensureRef<Space>(projectId)
    const issue = await fetchIssue(client, issueId)
    const commentId = await addComment(client, projectId, issueId, body)
    const url = await buildIssueUrl(client, issue)

    log.info({ userId, issueId, commentId, identifier: issue.identifier }, 'Comment added to issue')

    return {
      id: commentId,
      body,
      url,
    }
  })
}
