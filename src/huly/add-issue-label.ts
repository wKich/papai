import type { Space } from '@hcengineering/core'
import tags, { type TagElement } from '@hcengineering/tags'
import tracker, { type Issue } from '@hcengineering/tracker'

import { logger } from '../logger.js'
import { classifyHulyError } from './classify-error.js'
import { hulyUrl, hulyWorkspace } from './env.js'
import { getHulyClient } from './huly-client.js'
import { ensureRef } from './refs.js'

const log = logger.child({ scope: 'huly:add-issue-label' })

export interface AddIssueLabelParams {
  userId: number
  projectId: string
  issueId: string
  labelId: string
}

export interface AddIssueLabelResult {
  id: string
  identifier: string
  title: string
  url: string
}

async function findIssue(client: Awaited<ReturnType<typeof getHulyClient>>, issueId: string): Promise<Issue> {
  ensureRef<Issue>(issueId)
  const result = await client.findOne(tracker.class.Issue, { _id: issueId })

  if (result === undefined || result === null) {
    throw new Error(`Issue not found: ${issueId}`)
  }
  return result
}

async function addLabelToIssue(
  client: Awaited<ReturnType<typeof getHulyClient>>,
  projectId: string,
  issueId: string,
  labelId: string,
): Promise<void> {
  ensureRef<Space>(projectId)
  ensureRef<Issue>(issueId)
  ensureRef<TagElement>(labelId)
  await client.addCollection(tags.class.TagReference, projectId, issueId, tracker.class.Issue, 'labels', {
    title: '',
    color: 0,
    tag: labelId,
  })
}

async function buildIssueUrl(client: Awaited<ReturnType<typeof getHulyClient>>, issue: Issue): Promise<string> {
  const result = await client.findOne(tracker.class.Project, { _id: issue.space })

  if (result !== undefined && result !== null && 'identifier' in result) {
    return `${hulyUrl}/workbench/${hulyWorkspace}/tracker/${result.identifier}/${issue.identifier}`
  }
  log.warn({ space: issue.space }, 'Failed to find Project')
  return `${hulyUrl}/workbench/${hulyWorkspace}/tracker/UNK/${issue.identifier}`
}

export async function addIssueLabel({
  userId,
  projectId,
  issueId,
  labelId,
}: AddIssueLabelParams): Promise<AddIssueLabelResult> {
  log.debug({ userId, projectId, issueId, labelId }, 'addIssueLabel called')

  const client = await getHulyClient(userId)

  try {
    const issue = await findIssue(client, issueId)
    await addLabelToIssue(client, projectId, issueId, labelId)
    const url = await buildIssueUrl(client, issue)

    log.info({ userId, issueId, labelId, identifier: issue.identifier }, 'Label added to issue')

    return {
      id: issue._id,
      identifier: issue.identifier,
      title: issue.title,
      url,
    }
  } catch (error) {
    log.error(
      { error: error instanceof Error ? error.message : String(error), userId, issueId, labelId },
      'addIssueLabel failed',
    )
    throw classifyHulyError(error)
  } finally {
    await client.close()
  }
}
