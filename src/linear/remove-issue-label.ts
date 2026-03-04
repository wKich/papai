import { LinearClient } from '@linear/sdk'

import { linearError } from '../errors.js'
import { logger } from '../logger.js'
import { classifyLinearError } from './classify-error.js'
import { requireEntity } from './response-guards.js'

const log = logger.child({ scope: 'linear:remove-issue-label' })

export async function removeIssueLabel({
  apiKey,
  issueId,
  labelId,
}: {
  apiKey: string
  issueId: string
  labelId: string
}): Promise<{ id: string; identifier: string; title: string; url: string } | undefined> {
  log.debug({ issueId, labelId }, 'removeIssueLabel called')

  try {
    const client = new LinearClient({ apiKey })
    const payload = await client.issueRemoveLabel(issueId, labelId)
    const issue = requireEntity(await payload.issue, {
      entityName: 'issue',
      context: { issueId, labelId },
      appError: linearError.issueNotFound(issueId),
    })
    log.info({ issueId, labelId, identifier: issue.identifier }, 'Label removed from issue')
    return { id: issue.id, identifier: issue.identifier, title: issue.title, url: issue.url }
  } catch (error) {
    log.error(
      { error: error instanceof Error ? error.message : String(error), issueId, labelId },
      'removeIssueLabel failed',
    )
    throw classifyLinearError(error)
  }
}
