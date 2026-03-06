import core from '@hcengineering/core'
import tracker, { type Issue } from '@hcengineering/tracker'

import { linearError } from '../errors.js'
import { logger } from '../logger.js'
import { classifyHulyError, HulyApiError } from './classify-error.js'
import { getHulyClient } from './huly-client.js'

const log = logger.child({ scope: 'huly:add-issue-relation' })

type RelationType = 'blocks' | 'duplicate' | 'related'

interface RelatedIssueEntry {
  issueId: string
  type: RelationType
}

export async function addIssueRelation({
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
  log.debug({ userId, issueId, relatedIssueId, type }, 'addIssueRelation called')

  const client = await getHulyClient(userId)

  try {
    // Fetch the source issue
    const issue = (await client.findOne(tracker.class.Issue, {
      _id: issueId as unknown as Parameters<typeof client.findOne>[1]['_id'],
    } as unknown as Parameters<typeof client.findOne>[1])) as unknown as Issue | undefined

    if (!issue) {
      throw new HulyApiError(`Issue not found: ${issueId}`, linearError.issueNotFound(issueId))
    }

    // Fetch the related issue to verify it exists
    const relatedIssue = (await client.findOne(tracker.class.Issue, {
      _id: relatedIssueId as unknown as Parameters<typeof client.findOne>[1]['_id'],
    } as unknown as Parameters<typeof client.findOne>[1])) as unknown as Issue | undefined

    if (!relatedIssue) {
      throw new HulyApiError(`Related issue not found: ${relatedIssueId}`, linearError.issueNotFound(relatedIssueId))
    }

    // Get current relatedIssues array
    const currentRelatedIssues = (issue as unknown as { relatedIssues?: RelatedIssueEntry[] }).relatedIssues ?? []

    // Check if relation already exists
    const existingIndex = currentRelatedIssues.findIndex((entry) => entry.issueId === relatedIssueId)

    let updatedRelatedIssues: RelatedIssueEntry[]

    if (existingIndex !== -1) {
      // Update existing relation type
      updatedRelatedIssues = currentRelatedIssues.map((entry, index) =>
        index === existingIndex ? { ...entry, type } : entry,
      )
      log.debug({ userId, issueId, relatedIssueId, type }, 'Updating existing relation type')
    } else {
      // Add new relation
      updatedRelatedIssues = [...currentRelatedIssues, { issueId: relatedIssueId, type }]
    }

    // Update the issue with new relatedIssues array
    await client.updateDoc(
      tracker.class.Issue,
      core.space.Space as unknown as Parameters<typeof client.updateDoc>[1],
      issueId as unknown as Parameters<typeof client.updateDoc>[2],
      { relatedIssues: updatedRelatedIssues } as unknown as Parameters<typeof client.updateDoc>[3],
      false,
    )

    log.info({ userId, issueId, relatedIssueId, type }, 'Relation added/updated')

    return {
      id: `${issueId}-${relatedIssueId}`,
      type,
      relatedIssueId,
    }
  } catch (error) {
    log.error(
      { error: error instanceof Error ? error.message : String(error), userId, issueId, relatedIssueId },
      'addIssueRelation failed',
    )
    throw classifyHulyError(error)
  } finally {
    await client.close()
  }
}
