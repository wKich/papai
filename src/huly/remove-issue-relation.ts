import type { Ref, Space, DocumentUpdate } from '@hcengineering/core'
import core from '@hcengineering/core'
import tracker, { type Issue } from '@hcengineering/tracker'

import { hulyError } from '../errors.js'
import { logger } from '../logger.js'
import { classifyHulyError, HulyApiError } from './classify-error.js'
import { getHulyClient } from './huly-client.js'
import { ensureRef } from './refs.js'
import type { HulyClient } from './types.js'

const log = logger.child({ scope: 'huly:remove-issue-relation' })

interface RelatedIssueEntry {
  issueId: string
  type: string
}

type IssueRelationUpdate = DocumentUpdate<Issue> & { relatedIssues?: RelatedIssueEntry[] }

function getRelatedIssues(issue: Issue): RelatedIssueEntry[] {
  if (!('relatedIssues' in issue)) return []
  const field: unknown = issue['relatedIssues']
  if (!Array.isArray(field)) return []
  const items = Array.from<unknown>(field)
  return items.filter(
    (e): e is RelatedIssueEntry =>
      typeof e === 'object' &&
      e !== null &&
      'issueId' in e &&
      typeof e.issueId === 'string' &&
      'type' in e &&
      typeof e.type === 'string',
  )
}

async function removeRelationFromIssue(client: HulyClient, issueId: Ref<Issue>, relatedIssueId: string): Promise<void> {
  const issue = await client.findOne(tracker.class.Issue, { _id: issueId })

  if (issue === undefined || issue === null) {
    throw new HulyApiError(`Issue not found: ${issueId}`, hulyError.issueNotFound(issueId))
  }

  const currentRelatedIssues = getRelatedIssues(issue)
  const relationIndex = currentRelatedIssues.findIndex((entry) => entry.issueId === relatedIssueId)

  if (relationIndex === -1) {
    throw new HulyApiError(
      `Relation between issues "${issueId}" and "${relatedIssueId}" was not found.`,
      hulyError.relationNotFound(issueId, relatedIssueId),
    )
  }

  const updatedRelatedIssues = currentRelatedIssues.filter((entry) => entry.issueId !== relatedIssueId)

  const update: IssueRelationUpdate = { relatedIssues: updatedRelatedIssues }
  await client.updateDoc(tracker.class.Issue, core.space.Space as Ref<Space>, issueId, update, false)
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

  ensureRef<Issue>(issueId)

  try {
    await removeRelationFromIssue(client, issueId, relatedIssueId)

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
