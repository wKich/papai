import { LinearClient } from '@linear/sdk'

import { linearError } from '../errors.js'
import { logger } from '../logger.js'
import { classifyLinearError } from './classify-error.js'
import { filterPresentNodes, requireEntity } from './response-guards.js'

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
    const issue = requireEntity(await client.issue(issueId), {
      entityName: 'issue',
      context: { issueId },
      appError: linearError.issueNotFound(issueId),
    })
    const relations = await issue.relations()
    const result = await Promise.all(
      filterPresentNodes(relations.nodes, { entityName: 'relation', parentId: issueId }).map(async (r) => {
        if (typeof r.id !== 'string' || typeof r.type !== 'string') {
          logger.warn({ issueId, relationId: r.id }, 'Skipping relation with invalid response shape')
          return undefined
        }
        const relatedIssue = await r.relatedIssue
        return { id: r.id, type: r.type, relatedIssueId: relatedIssue?.id, relatedIdentifier: relatedIssue?.identifier }
      }),
    )
    const mappedRelations = result.flatMap((relation) => (relation ? [relation] : []))
    logger.info({ issueId, relationCount: mappedRelations.length }, 'Relations fetched')
    return mappedRelations
  } catch (error) {
    logger.error({ error: error instanceof Error ? error.message : String(error), issueId }, 'getRelations failed')
    throw classifyLinearError(error)
  }
}
