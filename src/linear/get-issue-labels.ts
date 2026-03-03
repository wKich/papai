import { LinearClient } from '@linear/sdk'

import { logger } from '../logger.js'
import { classifyLinearError } from './classify-error.js'

export async function getIssueLabels({
  apiKey,
  issueId,
}: {
  apiKey: string
  issueId: string
}): Promise<{ id: string; name: string; color: string }[]> {
  logger.debug({ issueId }, 'getIssueLabels called')

  try {
    const client = new LinearClient({ apiKey })
    const issue = await client.issue(issueId)
    const labels = await issue.labels()
    const result = labels.nodes.map((l) => ({ id: l.id, name: l.name, color: l.color }))
    logger.info({ issueId, labelCount: result.length }, 'Issue labels fetched')
    return result
  } catch (error) {
    logger.error({ error: error instanceof Error ? error.message : String(error), issueId }, 'getIssueLabels failed')
    throw classifyLinearError(error)
  }
}
