import type { Ref, Space } from '@hcengineering/core'
import core from '@hcengineering/core'
import tracker, { type Issue, type IssueStatus } from '@hcengineering/tracker'

import { logger } from '../logger.js'
import { classifyHulyError } from './classify-error.js'
import { getHulyClient } from './huly-client.js'
import { ensureRef } from './refs.js'

const log = logger.child({ scope: 'huly:archive-issue' })

export async function archiveIssue({
  userId,
  issueId,
}: {
  userId: number
  issueId: string
}): Promise<{ id: string; identifier: string; title: string; archivedAt: string } | undefined> {
  log.debug({ userId, issueId }, 'archiveIssue called')

  const client = await getHulyClient(userId)

  ensureRef<Issue>(issueId)

  try {
    const issue = await fetchIssue(client, issueId)
    await archiveIssueByStatus(client, issueId)
    const archivedAt = new Date().toISOString()

    log.info({ userId, issueId, identifier: issue.identifier, archivedAt }, 'Issue archived')

    return {
      id: issue._id,
      identifier: issue.identifier,
      title: issue.title,
      archivedAt,
    }
  } catch (error) {
    log.error({ error: error instanceof Error ? error.message : String(error), userId, issueId }, 'archiveIssue failed')
    throw classifyHulyError(error)
  } finally {
    await client.close()
  }
}

async function fetchIssue(client: Awaited<ReturnType<typeof getHulyClient>>, issueId: Ref<Issue>): Promise<Issue> {
  const result = await client.findOne(tracker.class.Issue, { _id: issueId })

  if (result === undefined || result === null) {
    throw new Error(`Issue not found: ${issueId}`)
  }
  return result
}

async function archiveIssueByStatus(
  client: Awaited<ReturnType<typeof getHulyClient>>,
  issueId: Ref<Issue>,
): Promise<void> {
  const result = await client.findOne(tracker.class.IssueStatus, { name: 'Archived' })

  const archivedStatus: IssueStatus | undefined = result ?? undefined

  if (archivedStatus === undefined) {
    log.warn({ issueId }, 'Archived status not found, issue will not be archived by status')
  } else {
    await client.updateDoc(
      tracker.class.Issue,
      core.space.Space as Ref<Space>,
      issueId,
      { status: archivedStatus._id },
      false,
    )
  }
}
