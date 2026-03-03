import { type Issue, type LinearFetch, LinearClient } from '@linear/sdk'

import { logger } from '../logger.js'
import { classifyLinearError } from './classify-error.js'

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
  logger.debug({ title, teamId, priority, dueDate, estimate }, 'createIssue called')

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
      logger.info({ issueId: issue.id, identifier: issue.identifier, title }, 'Issue created')
    }
    return await payload.issue
  } catch (error) {
    logger.error({ error: error instanceof Error ? error.message : String(error), title, teamId }, 'createIssue failed')
    throw classifyLinearError(error)
  }
}
