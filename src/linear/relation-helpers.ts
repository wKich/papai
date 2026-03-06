import type { Issue, IssueRelation } from '@linear/sdk'

import { linearError } from '../errors.js'
import { HulyApiError } from './classify-error.js'
import { filterPresentNodes } from './response-guards.js'

interface RelationWithRelatedIssue {
  relation: IssueRelation
  related: { id: string } | null | undefined
}

export async function findRelationByRelatedIssueId({
  issue,
  relatedIssueId,
}: {
  issue: Issue
  relatedIssueId: string
}): Promise<IssueRelation> {
  const issueId = issue.id
  const relations = await issue.relations()
  const validRelations = filterPresentNodes(relations.nodes, { entityName: 'relation', parentId: issueId })

  // Fetch all related issues in parallel
  const relatedIssues: RelationWithRelatedIssue[] = await Promise.all(
    validRelations.map(async (r) => ({ relation: r, related: await r.relatedIssue })),
  )

  const found = relatedIssues.find(
    (item) => item.related !== null && item.related !== undefined && item.related.id === relatedIssueId,
  )

  if (found === undefined) {
    throw new HulyApiError(
      `Relation between issues "${issueId}" and "${relatedIssueId}" was not found.`,
      linearError.relationNotFound(issueId, relatedIssueId),
    )
  }

  return found.relation
}
