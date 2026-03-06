import { LinearClient } from '@linear/sdk'

import { linearError } from '../errors.js'
import { logger } from '../logger.js'
import { classifyHulyError } from './classify-error.js'
import { requireEntity } from './response-guards.js'

const log = logger.child({ scope: 'linear:add-issue-label' })

export async function addIssueLabel({
  apiKey,
  issueId,
  labelId,
}: {
  apiKey: string
  issueId: string
  labelId: string
}): Promise<{ id: string; identifier: string; title: string; url: string }> {
  log.debug({ issueId, labelId }, 'addIssueLabel called')

  try {
    const client = new LinearClient({ apiKey })
    const payload = await client.issueAddLabel(issueId, labelId)
    const issue = requireEntity(await payload.issue, {
      entityName: 'issue',
      context: { issueId, labelId },
      appError: linearError.issueNotFound(issueId),
    })
    log.info({ issueId, labelId, identifier: issue.identifier }, 'Label added to issue')
    return { id: issue.id, identifier: issue.identifier, title: issue.title, url: issue.url }
  } catch (error) {
    log.error(
      { error: error instanceof Error ? error.message : String(error), issueId, labelId },
      'addIssueLabel failed',
    )
    throw classifyHulyError(error)
  }
}
