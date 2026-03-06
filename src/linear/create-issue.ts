import { type Issue, type LinearFetch, LinearClient } from '@linear/sdk'

import { logger } from '../logger.js'
import { classifyHulyError } from './classify-error.js'

const log = logger.child({ scope: 'linear:create-issue' })

export async function createIssue({
  apiKey,
  title,
  description,
  priority,
  projectId,
  teamId,
  dueDate,
  labelIds,
  estimate,
}: {
  apiKey: string
  title: string
  description?: string
  priority?: number
  projectId?: string
  teamId: string
  dueDate?: string
  labelIds?: string[]
  estimate?: number
}): Promise<LinearFetch<Issue> | undefined> {
  log.debug({ title, teamId, priority, dueDate, estimate }, 'createIssue called')

  try {
    const client = new LinearClient({ apiKey })
    const payload = await client.createIssue({
      title,
      description,
      priority,
      projectId,
      teamId,
      dueDate,
      labelIds,
      estimate,
    })
    const issue = await payload.issue
    if (issue) {
      log.info({ issueId: issue.id, identifier: issue.identifier, title }, 'Issue created')
    }
    return await payload.issue
  } catch (error) {
    log.error({ error: error instanceof Error ? error.message : String(error), title, teamId }, 'createIssue failed')
    throw classifyHulyError(error)
  }
}
