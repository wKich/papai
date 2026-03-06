import { IssueRelationType, LinearClient } from '@linear/sdk'

import { linearError } from '../errors.js'
import { logger } from '../logger.js'
import { classifyLinearError } from './classify-error.js'
import { findRelationByRelatedIssueId } from './relation-helpers.js'
import { requireEntity } from './response-guards.js'

const log = logger.child({ scope: 'linear:update-issue-relation' })

const typeMap: Record<'blocks' | 'duplicate' | 'related', IssueRelationType> = {
  blocks: IssueRelationType.Blocks,
  duplicate: IssueRelationType.Duplicate,
  related: IssueRelationType.Related,
}

export async function updateIssueRelation({
  apiKey,
  issueId,
  relatedIssueId,
  type,
}: {
  apiKey: string
  issueId: string
  relatedIssueId: string
  type: 'blocks' | 'duplicate' | 'related'
}): Promise<{ id: string; type: string; relatedIssueId: string }> {
  log.debug({ issueId, relatedIssueId, type }, 'updateIssueRelation called')

  try {
    const client = new LinearClient({ apiKey })

    const issue = requireEntity(await client.issue(issueId), {
      entityName: 'issue',
      context: { issueId },
      appError: linearError.issueNotFound(issueId),
    })

    const foundRelation = await findRelationByRelatedIssueId({ issue, relatedIssueId })

    const payload = await client.updateIssueRelation(foundRelation.id, {
      type: typeMap[type],
    })

    const updatedRelation = requireEntity(await payload.issueRelation, {
      entityName: 'issue relation',
      context: { issueId, relatedIssueId, relationId: foundRelation.id },
      appError: linearError.relationNotFound(issueId, relatedIssueId),
    })

    log.info({ issueId, relatedIssueId, type, relationId: updatedRelation.id }, 'Relation updated')
    return { id: updatedRelation.id, type: updatedRelation.type, relatedIssueId }
  } catch (error) {
    log.error(
      { error: error instanceof Error ? error.message : String(error), issueId, relatedIssueId },
      'updateIssueRelation failed',
    )
    throw classifyLinearError(error)
  }
}
