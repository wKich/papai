/* oxlint-disable @typescript-eslint/no-unsafe-type-assertion */
import core from '@hcengineering/core'
import tracker, { type Issue } from '@hcengineering/tracker'

import { logger } from '../logger.js'
import { classifyHulyError } from './classify-error.js'
import { getHulyClient } from './huly-client.js'

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

  try {
    // Fetch the issue first
    const issue = (await client.findOne(tracker.class.Issue, {
      _id: issueId as unknown as Parameters<typeof client.findOne>[1]['_id'],
    } as unknown as Parameters<typeof client.findOne>[1])) as unknown as Issue | undefined

    if (!issue) {
      throw new Error(`Issue not found: ${issueId}`)
    }

    // In Huly, archiving is typically done by setting the status to an archived state
    // or by updating an archived field. We'll update the isArchived field if it exists,
    // or we can move it to an "Archived" status

    // Try to find an archived status
    const archivedStatus = (await client.findOne(tracker.class.IssueStatus, {
      name: 'Archived',
    } as unknown as Parameters<typeof client.findOne>[1])) as unknown as { _id: string } | undefined

    if (archivedStatus) {
      // Move to Archived status
      await client.updateDoc(
        tracker.class.Issue,
        core.space.Space as unknown as Parameters<typeof client.updateDoc>[1],
        issueId as unknown as Parameters<typeof client.updateDoc>[2],
        { status: archivedStatus._id } as unknown as Parameters<typeof client.updateDoc>[3],
        false,
      )
    } else {
      // Try to update isArchived field if it exists
      await client.updateDoc(
        tracker.class.Issue,
        core.space.Space as unknown as Parameters<typeof client.updateDoc>[1],
        issueId as unknown as Parameters<typeof client.updateDoc>[2],
        { isArchived: true } as unknown as Parameters<typeof client.updateDoc>[3],
        false,
      )
    }

    const archivedAt = new Date().toISOString()

    log.info({ userId, issueId, identifier: issue.identifier, archivedAt }, 'Issue archived')

    return {
      id: issue._id as string,
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
