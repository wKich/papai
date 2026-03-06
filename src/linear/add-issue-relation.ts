import { IssueRelationType, LinearClient } from '@linear/sdk'

import { linearError } from '../errors.js'
import { logger } from '../logger.js'
import { classifyHulyError } from './classify-error.js'
import { requireEntity } from './response-guards.js'

const log = logger.child({ scope: 'linear:add-issue-relation' })

export async function addIssueRelation({
  apiKey,
  issueId,
  relatedIssueId,
  type,
}: {
  apiKey: string
  issueId: string
  relatedIssueId: string
  type: 'blocks' | 'duplicate' | 'related'
}): Promise<{ id: string; type: string }> {
  log.debug({ issueId, relatedIssueId, type }, 'addIssueRelation called')

  const typeMap: Record<'blocks' | 'duplicate' | 'related', IssueRelationType> = {
    blocks: IssueRelationType.Blocks,
    duplicate: IssueRelationType.Duplicate,
    related: IssueRelationType.Related,
  }

  try {
    const client = new LinearClient({ apiKey })
    const payload = await client.createIssueRelation({ issueId, relatedIssueId, type: typeMap[type] })
    const relation = requireEntity(await payload.issueRelation, {
      entityName: 'issue relation',
      context: { issueId, relatedIssueId },
      appError: linearError.unknown(new Error('Linear API did not return relation after creation')),
    })
    log.info({ issueId, relatedIssueId, type, relationId: relation.id }, 'Relation created')
    return { id: relation.id, type: relation.type }
  } catch (error) {
    log.error(
      { error: error instanceof Error ? error.message : String(error), issueId, relatedIssueId },
      'addIssueRelation failed',
    )
    throw classifyHulyError(error)
  }
}
