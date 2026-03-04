import { LinearClient } from '@linear/sdk'

import { linearError } from '../errors.js'
import { logger } from '../logger.js'
import { classifyLinearError } from './classify-error.js'
import { requireEntity } from './response-guards.js'

export async function archiveIssue({
  apiKey,
  issueId,
}: {
  apiKey: string
  issueId: string
}): Promise<{ id: string; identifier: string; title: string; archivedAt: string } | undefined> {
  logger.debug({ issueId }, 'archiveIssue called')

  try {
    const client = new LinearClient({ apiKey })
    const payload = await client.archiveIssue(issueId)
    const issue = requireEntity(await payload.entity, {
      entityName: 'issue',
      context: { issueId },
      appError: linearError.issueNotFound(issueId),
    })
    logger.info({ issueId, identifier: issue.identifier, archivedAt: issue.archivedAt }, 'Issue archived')
    return {
      id: issue.id,
      identifier: issue.identifier,
      title: issue.title,
      archivedAt: issue.archivedAt ? issue.archivedAt.toISOString() : new Date().toISOString(),
    }
  } catch (error) {
    logger.error({ error: error instanceof Error ? error.message : String(error), issueId }, 'archiveIssue failed')
    throw classifyLinearError(error)
  }
}
