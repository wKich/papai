import { type Issue, LinearClient } from '@linear/sdk'
import { z } from 'zod'

import { linearError } from '../errors.js'
import { logger } from '../logger.js'
import { classifyLinearError } from './classify-error.js'
import { type MappedLabel, type MappedRelation, mapLabels, mapRelations } from './issue-mappers.js'
import { requireEntity } from './response-guards.js'

const log = logger.child({ scope: 'linear:get-issue' })

const dueDateSchema = z.object({ dueDate: z.string().nullable().optional().catch(undefined) })

interface IssueData {
  state: string | undefined
  assignee: string | undefined
  labels: MappedLabel[]
  relations: MappedRelation[]
  dueDate: string | null | undefined
}

async function fetchIssueData(issue: Issue, issueId: string): Promise<IssueData> {
  const [state, assignee, labels, relations] = await Promise.all([
    issue.state,
    issue.assignee,
    issue.labels(),
    issue.relations(),
  ])
  const { dueDate } = dueDateSchema.parse(issue)
  const [mappedLabels, mappedRelations] = await Promise.all([
    mapLabels(labels, issueId),
    mapRelations(relations, issueId),
  ])
  return {
    state: state?.name,
    assignee: assignee?.displayName,
    labels: mappedLabels,
    relations: mappedRelations,
    dueDate,
  }
}

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
  labels: { id: string; name: string; color: string }[]
  relations: { id: string; type: string; relatedIssueId: string | undefined; relatedIdentifier: string | undefined }[]
}> {
  log.debug({ issueId }, 'getIssue called')

  try {
    const client = new LinearClient({ apiKey })
    const issue = requireEntity(await client.issue(issueId), {
      entityName: 'issue',
      context: { issueId },
      appError: linearError.issueNotFound(issueId),
    })
    const data = await fetchIssueData(issue, issueId)
    log.info(
      { issueId, identifier: issue.identifier, labelCount: data.labels.length, relationCount: data.relations.length },
      'Issue fetched',
    )
    return {
      id: issue.id,
      identifier: issue.identifier,
      title: issue.title,
      description: issue.description ?? undefined,
      priority: issue.priority,
      url: issue.url,
      dueDate: data.dueDate,
      estimate: issue.estimate,
      state: data.state,
      assignee: data.assignee,
      labels: data.labels,
      relations: data.relations,
    }
  } catch (error) {
    log.error({ error: error instanceof Error ? error.message : String(error), issueId }, 'getIssue failed')
    throw classifyLinearError(error)
  }
}
