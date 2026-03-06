import { LinearClient } from '@linear/sdk'

import { linearError } from '../errors.js'
import { logger } from '../logger.js'
import { classifyLinearError } from './classify-error.js'
import { findRelationByRelatedIssueId } from './relation-helpers.js'
import { requireEntity } from './response-guards.js'

const log = logger.child({ scope: 'linear:remove-issue-relation' })

export async function removeIssueRelation({
  apiKey,
  issueId,
  relatedIssueId,
}: {
  apiKey: string
  issueId: string
  relatedIssueId: string
}): Promise<{ id: string; success: true }> {
  log.debug({ issueId, relatedIssueId }, 'removeIssueRelation called')

  try {
    const client = new LinearClient({ apiKey })

    const issue = requireEntity(await client.issue(issueId), {
      entityName: 'issue',
      context: { issueId },
      appError: linearError.issueNotFound(issueId),
    })

    const foundRelation = await findRelationByRelatedIssueId({ issue, relatedIssueId })

    await client.deleteIssueRelation(foundRelation.id)
    log.info({ issueId, relatedIssueId, relationId: foundRelation.id }, 'Relation removed')
    return { id: foundRelation.id, success: true }
  } catch (error) {
    log.error(
      { error: error instanceof Error ? error.message : String(error), issueId, relatedIssueId },
      'removeIssueRelation failed',
    )
    throw classifyLinearError(error)
  }
}
