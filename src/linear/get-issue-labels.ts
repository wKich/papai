import { LinearClient } from '@linear/sdk'

import { linearError } from '../errors.js'
import { logger } from '../logger.js'
import { classifyLinearError } from './classify-error.js'
import { filterPresentNodes, requireEntity } from './response-guards.js'

const log = logger.child({ scope: 'linear:get-issue-labels' })

export async function getIssueLabels({
  apiKey,
  issueId,
}: {
  apiKey: string
  issueId: string
}): Promise<{ id: string; name: string; color: string }[]> {
  log.debug({ issueId }, 'getIssueLabels called')

  try {
    const client = new LinearClient({ apiKey })
    const issue = requireEntity(await client.issue(issueId), {
      entityName: 'issue',
      context: { issueId },
      appError: linearError.issueNotFound(issueId),
    })
    const labels = await issue.labels()
    const result = filterPresentNodes(labels.nodes, { entityName: 'label', parentId: issueId }).flatMap((l) => {
      if (typeof l.id !== 'string' || typeof l.name !== 'string' || typeof l.color !== 'string') {
        log.warn({ issueId, labelId: l.id }, 'Skipping label with invalid response shape')
        return []
      }
      return [{ id: l.id, name: l.name, color: l.color }]
    })
    log.info({ issueId, labelCount: result.length }, 'Issue labels fetched')
    return result
  } catch (error) {
    log.error({ error: error instanceof Error ? error.message : String(error), issueId }, 'getIssueLabels failed')
    throw classifyLinearError(error)
  }
}
