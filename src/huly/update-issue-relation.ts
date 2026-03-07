import type { Ref, Space, DocumentUpdate } from '@hcengineering/core'
import core from '@hcengineering/core'
import tracker, { type Issue } from '@hcengineering/tracker'

import { hulyError } from '../errors.js'
import { logger } from '../logger.js'
import { classifyHulyError, HulyApiError } from './classify-error.js'
import { getHulyClient } from './huly-client.js'
import { ensureRef } from './refs.js'
import type { HulyClient } from './types.js'

const log = logger.child({ scope: 'huly:update-issue-relation' })

type RelationType = 'blocks' | 'duplicate' | 'related'

interface RelatedIssueEntry {
  issueId: string
  type: RelationType
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

async function fetchIssueWithRelations(
  client: HulyClient,
  issueId: Ref<Issue>,
): Promise<{ issue: Issue; relations: RelatedIssueEntry[] }> {
  const issue = await client.findOne(tracker.class.Issue, { _id: issueId })

  if (issue === undefined || issue === null) {
    throw new HulyApiError(`Issue not found: ${issueId}`, hulyError.issueNotFound(issueId))
  }

  const relations = getRelatedIssues(issue)
  return { issue, relations }
}

function findRelationIndex(relations: RelatedIssueEntry[], relatedIssueId: string): number {
  return relations.findIndex((entry) => entry.issueId === relatedIssueId)
}

function updateRelationType(relations: RelatedIssueEntry[], index: number, type: RelationType): RelatedIssueEntry[] {
  return relations.map((entry, i) => (i === index ? { ...entry, type } : entry))
}

async function saveRelations(client: HulyClient, issueId: Ref<Issue>, relations: RelatedIssueEntry[]): Promise<void> {
  const update: IssueRelationUpdate = { relatedIssues: relations }
  await client.updateDoc(tracker.class.Issue, core.space.Space as Ref<Space>, issueId, update, false)
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

  ensureRef<Issue>(issueId)

  try {
    const { relations: currentRelatedIssues } = await fetchIssueWithRelations(client, issueId)

    const relationIndex = findRelationIndex(currentRelatedIssues, relatedIssueId)

    if (relationIndex === -1) {
      throw new HulyApiError(
        `Relation between issues "${issueId}" and "${relatedIssueId}" was not found.`,
        hulyError.relationNotFound(issueId, relatedIssueId),
      )
    }

    const updatedRelatedIssues = updateRelationType(currentRelatedIssues, relationIndex, type)
    await saveRelations(client, issueId, updatedRelatedIssues)

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
