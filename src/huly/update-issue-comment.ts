import chunter, { type ChatMessage } from '@hcengineering/chunter'
import type { Ref, Space } from '@hcengineering/core'
import tracker, { type Issue } from '@hcengineering/tracker'

import { logger } from '../logger.js'
import { classifyHulyError } from './classify-error.js'
import { hulyUrl, hulyWorkspace } from './env.js'
import { getHulyClient } from './huly-client.js'
import { ensureRef } from './refs.js'

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

async function findIssue(client: Awaited<ReturnType<typeof getHulyClient>>, issueId: Ref<Issue>): Promise<Issue> {
  const issue = await client.findOne(tracker.class.Issue, { _id: issueId })

  if (issue === undefined || issue === null) {
    throw new Error(`Issue not found: ${issueId}`)
  }

  return issue
}

async function findComment(
  client: Awaited<ReturnType<typeof getHulyClient>>,
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

async function updateComment(
  client: Awaited<ReturnType<typeof getHulyClient>>,
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

async function buildCommentUrl(client: Awaited<ReturnType<typeof getHulyClient>>, issue: Issue): Promise<string> {
  const project = await client.findOne(tracker.class.Project, { _id: issue.space })

  if (project !== undefined && project !== null && 'identifier' in project) {
    return `${hulyUrl}/workbench/${hulyWorkspace}/tracker/${project.identifier}/${issue.identifier}`
  }

  return `${hulyUrl}/workbench/${hulyWorkspace}/tracker/UNK/${issue.identifier}`
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

  ensureRef<Issue>(issueId)
  ensureRef<ChatMessage>(commentId)
  ensureRef<Space>(projectId)

  try {
    const issue = await findIssue(client, issueId)
    await findComment(client, commentId, issueId)
    await updateComment(client, projectId, commentId, issueId, body)
    const url = await buildCommentUrl(client, issue)

    log.info({ userId, issueId, commentId, identifier: issue.identifier }, 'Comment updated')

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
