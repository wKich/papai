import type { Ref, Space } from '@hcengineering/core'
import core from '@hcengineering/core'
import tracker, { type Issue, type IssueStatus } from '@hcengineering/tracker'

import { logger } from '../logger.js'
import { getHulyClient } from './huly-client.js'
import type { HulyClient } from './types.js'
import { fetchIssue } from './utils/fetchers.js'
import { withClient } from './utils/with-client.js'

const log = logger.child({ scope: 'huly:archive-issue' })

export function archiveIssue({
  userId,
  issueId,
}: {
  userId: number
  issueId: string
}): Promise<{ id: string; identifier: string; title: string; archivedAt: string } | undefined> {
  log.debug({ userId, issueId }, 'archiveIssue called')

  return withClient(userId, getHulyClient, async (client) => {
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
  })
}

async function archiveIssueByStatus(client: HulyClient, issueId: Ref<Issue>): Promise<void> {
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
