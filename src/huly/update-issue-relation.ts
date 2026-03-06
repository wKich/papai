import core from '@hcengineering/core'
import tracker, { type Issue } from '@hcengineering/tracker'

import { hulyError } from '../errors.js'
import { logger } from '../logger.js'
import { classifyHulyError, HulyApiError } from './classify-error.js'
import { getHulyClient } from './huly-client.js'

const log = logger.child({ scope: 'huly:update-issue-relation' })

type RelationType = 'blocks' | 'duplicate' | 'related'

interface RelatedIssueEntry {
  issueId: string
  type: RelationType
}

export async function updateIssueRelation({
  userId,
  issueId,
  relatedIssueId,
  type,
}: {
  userId: number
  issueId: string
  relatedIssueId: string
  type: RelationType
}): Promise<{ id: string; type: string; relatedIssueId: string }> {
  log.debug({ userId, issueId, relatedIssueId, type }, 'updateIssueRelation called')

  const client = await getHulyClient(userId)

  try {
    // Fetch the source issue
    const issue = (await client.findOne(tracker.class.Issue, {
      _id: issueId as unknown as Parameters<typeof client.findOne>[1]['_id'],
    } as unknown as Parameters<typeof client.findOne>[1])) as unknown as Issue | undefined

    if (!issue) {
      throw new HulyApiError(`Issue not found: ${issueId}`, hulyError.issueNotFound(issueId))
    }

    // Get current relatedIssues array
    const currentRelatedIssues = (issue as unknown as { relatedIssues?: RelatedIssueEntry[] }).relatedIssues ?? []

    // Find the relation to update
    const relationIndex = currentRelatedIssues.findIndex((entry) => entry.issueId === relatedIssueId)

    if (relationIndex === -1) {
      throw new HulyApiError(
        `Relation between issues "${issueId}" and "${relatedIssueId}" was not found.`,
        hulyError.relationNotFound(issueId, relatedIssueId),
      )
    }

    // Update the relation type
    const updatedRelatedIssues = currentRelatedIssues.map((entry, index) =>
      index === relationIndex ? { ...entry, type } : entry,
    )

    // Update the issue with modified relatedIssues array
    await client.updateDoc(
      tracker.class.Issue,
      core.space.Space as unknown as Parameters<typeof client.updateDoc>[1],
      issueId as unknown as Parameters<typeof client.updateDoc>[2],
      { relatedIssues: updatedRelatedIssues } as unknown as Parameters<typeof client.updateDoc>[3],
      false,
    )

    log.info({ userId, issueId, relatedIssueId, type }, 'Relation type updated')

    return {
      id: `${issueId}-${relatedIssueId}`,
      type,
      relatedIssueId,
    }
  } catch (error) {
    log.error(
      { error: error instanceof Error ? error.message : String(error), userId, issueId, relatedIssueId },
      'updateIssueRelation failed',
    )
    throw classifyHulyError(error)
  } finally {
    await client.close()
  }
}
