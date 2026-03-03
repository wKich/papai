import { IssueRelationType, LinearClient } from '@linear/sdk'

import { logger } from '../logger.js'
import { classifyLinearError } from './classify-error.js'

export async function createRelation({
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
  logger.debug({ issueId, relatedIssueId, type }, 'createRelation called')

  const typeMap: Record<'blocks' | 'duplicate' | 'related', IssueRelationType> = {
    blocks: IssueRelationType.Blocks,
    duplicate: IssueRelationType.Duplicate,
    related: IssueRelationType.Related,
  }

  try {
    const client = new LinearClient({ apiKey })
    const payload = await client.createIssueRelation({ issueId, relatedIssueId, type: typeMap[type] })
    const relation = await payload.issueRelation
    if (!relation) {
      throw new Error('No relation returned')
    }
    logger.info({ issueId, relatedIssueId, type, relationId: relation.id }, 'Relation created')
    return { id: relation.id, type: relation.type }
  } catch (error) {
    logger.error(
      { error: error instanceof Error ? error.message : String(error), issueId, relatedIssueId },
      'createRelation failed',
    )
    throw classifyLinearError(error)
  }
}
