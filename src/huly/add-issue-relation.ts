import type { Ref, Space, DocumentUpdate } from '@hcengineering/core'
import core from '@hcengineering/core'
import tracker, { type Issue } from '@hcengineering/tracker'

import { hulyError } from '../errors.js'
import { logger } from '../logger.js'
import { classifyHulyError, HulyApiError } from './classify-error.js'
import { getHulyClient } from './huly-client.js'
import { ensureRef } from './refs.js'

const log = logger.child({ scope: 'huly:add-issue-relation' })

type RelationType = 'blocks' | 'duplicate' | 'related'

interface RelatedIssueEntry {
  issueId: string
  type: RelationType
}

type IssueRelationUpdate = DocumentUpdate<Issue> & { relatedIssues?: RelatedIssueEntry[] }

type HulyClient = Awaited<ReturnType<typeof getHulyClient>>

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

async function fetchIssue(client: HulyClient, issueId: Ref<Issue>, errorMessage: string): Promise<Issue> {
  const result = await client.findOne(tracker.class.Issue, { _id: issueId })

  if (result === undefined || result === null) {
    throw new HulyApiError(errorMessage, hulyError.issueNotFound(issueId))
  }
  return result
}

function buildUpdatedRelations(
  currentRelations: RelatedIssueEntry[],
  relatedIssueId: string,
  type: RelationType,
): RelatedIssueEntry[] {
  const existingIndex = currentRelations.findIndex((entry) => entry.issueId === relatedIssueId)

  if (existingIndex === -1) {
    return [...currentRelations, { issueId: relatedIssueId, type }]
  }
  return currentRelations.map((entry, index) => (index === existingIndex ? { ...entry, type } : entry))
}

async function updateIssueRelations(
  client: HulyClient,
  issueId: Ref<Issue>,
  relations: RelatedIssueEntry[],
): Promise<void> {
  const update: IssueRelationUpdate = { relatedIssues: relations }
  await client.updateDoc(tracker.class.Issue, core.space.Space as Ref<Space>, issueId, update, false)
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

  ensureRef<Issue>(issueId)

  try {
    const issue = await fetchIssue(client, issueId, `Issue not found: ${issueId}`)
    ensureRef<Issue>(relatedIssueId)
    await fetchIssue(client, relatedIssueId, `Related issue not found: ${relatedIssueId}`)

    const currentRelatedIssues = getRelatedIssues(issue)
    const updatedRelatedIssues = buildUpdatedRelations(currentRelatedIssues, relatedIssueId, type)

    if (currentRelatedIssues.some((entry) => entry.issueId === relatedIssueId)) {
      log.debug({ userId, issueId, relatedIssueId, type }, 'Updating existing relation type')
    }

    await updateIssueRelations(client, issueId, updatedRelatedIssues)

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
