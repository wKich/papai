import core from '@hcengineering/core'
import tracker, { type Issue } from '@hcengineering/tracker'

import { linearError } from '../errors.js'
import { logger } from '../logger.js'
import { classifyHulyError, HulyApiError } from './classify-error.js'
import { getHulyClient } from './huly-client.js'

const log = logger.child({ scope: 'huly:remove-issue-relation' })

interface RelatedIssueEntry {
  issueId: string
  type: string
}

export async function removeIssueRelation({
  userId,
  issueId,
  relatedIssueId,
}: {
  userId: number
  issueId: string
  relatedIssueId: string
}): Promise<{ id: string; success: true }> {
  log.debug({ userId, issueId, relatedIssueId }, 'removeIssueRelation called')

  const client = await getHulyClient(userId)

  try {
    // Fetch the source issue
    const issue = (await client.findOne(tracker.class.Issue, {
      _id: issueId as unknown as Parameters<typeof client.findOne>[1]['_id'],
    } as unknown as Parameters<typeof client.findOne>[1])) as unknown as Issue | undefined

    if (!issue) {
      throw new HulyApiError(`Issue not found: ${issueId}`, linearError.issueNotFound(issueId))
    }

    // Get current relatedIssues array
    const currentRelatedIssues = (issue as unknown as { relatedIssues?: RelatedIssueEntry[] }).relatedIssues ?? []

    // Find the relation to remove
    const relationIndex = currentRelatedIssues.findIndex((entry) => entry.issueId === relatedIssueId)

    if (relationIndex === -1) {
      throw new HulyApiError(
        `Relation between issues "${issueId}" and "${relatedIssueId}" was not found.`,
        linearError.relationNotFound(issueId, relatedIssueId),
      )
    }

    // Remove the relation from the array
    const updatedRelatedIssues = currentRelatedIssues.filter((entry) => entry.issueId !== relatedIssueId)

    // Update the issue with modified relatedIssues array
    await client.updateDoc(
      tracker.class.Issue,
      core.space.Space as unknown as Parameters<typeof client.updateDoc>[1],
      issueId as unknown as Parameters<typeof client.updateDoc>[2],
      { relatedIssues: updatedRelatedIssues } as unknown as Parameters<typeof client.updateDoc>[3],
      false,
    )

    log.info({ userId, issueId, relatedIssueId }, 'Relation removed')

    return {
      id: `${issueId}-${relatedIssueId}`,
      success: true,
    }
  } catch (error) {
    log.error(
      { error: error instanceof Error ? error.message : String(error), userId, issueId, relatedIssueId },
      'removeIssueRelation failed',
    )
    throw classifyHulyError(error)
  } finally {
    await client.close()
  }
}
