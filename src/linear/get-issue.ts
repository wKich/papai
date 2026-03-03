import { LinearClient } from '@linear/sdk'
import { z } from 'zod'

import { logger } from '../logger.js'
import { classifyLinearError } from './classify-error.js'

export async function getIssue({ apiKey, issueId }: { apiKey: string; issueId: string }): Promise<{
  id: string
  identifier: string
  title: string
  description: string | undefined
  priority: number
  url: string
  dueDate: string | null | undefined
  estimate: number | null | undefined
  state: string | undefined
  assignee: string | undefined
}> {
  logger.debug({ issueId }, 'getIssue called')

  try {
    const client = new LinearClient({ apiKey })
    const issue = await client.issue(issueId)
    const [state, assignee] = await Promise.all([issue.state, issue.assignee])
    const dueDateSchema = z.object({ dueDate: z.string().nullable().optional().catch(undefined) })
    const { dueDate } = dueDateSchema.parse(issue)
    const result = {
      id: issue.id,
      identifier: issue.identifier,
      title: issue.title,
      description: issue.description ?? undefined,
      priority: issue.priority,
      url: issue.url,
      dueDate,
      estimate: issue.estimate,
      state: state?.name,
      assignee: assignee?.displayName,
    }
    logger.info({ issueId, identifier: issue.identifier }, 'Issue fetched')
    return result
  } catch (error) {
    logger.error({ error: error instanceof Error ? error.message : String(error), issueId }, 'getIssue failed')
    throw classifyLinearError(error)
  }
}
