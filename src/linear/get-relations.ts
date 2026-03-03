import { LinearClient } from '@linear/sdk'

import { logger } from '../logger.js'
import { classifyLinearError } from './classify-error.js'

export async function getRelations({
  apiKey,
  issueId,
}: {
  apiKey: string
  issueId: string
}): Promise<{ id: string; type: string; relatedIssueId: string | undefined; relatedIdentifier: string | undefined }[]> {
  logger.debug({ issueId }, 'getRelations called')

  try {
    const client = new LinearClient({ apiKey })
    const issue = await client.issue(issueId)
    const relations = await issue.relations()
    const result = await Promise.all(
      relations.nodes.map(async (r) => {
        const relatedIssue = await r.relatedIssue
        return { id: r.id, type: r.type, relatedIssueId: relatedIssue?.id, relatedIdentifier: relatedIssue?.identifier }
      }),
    )
    logger.info({ issueId, relationCount: result.length }, 'Relations fetched')
    return result
  } catch (error) {
    logger.error({ error: error instanceof Error ? error.message : String(error), issueId }, 'getRelations failed')
    throw classifyLinearError(error)
  }
}
