import type { DocumentQuery } from '@hcengineering/core'
import { SortingOrder } from '@hcengineering/core'
import tracker, { type Issue, type IssueStatus, type Project } from '@hcengineering/tracker'

import { logger } from '../logger.js'
import { classifyHulyError } from './classify-error.js'
import { hulyUrl, hulyWorkspace } from './env.js'
import { getHulyClient } from './huly-client.js'
import { ensureRef } from './refs.js'

const log = logger.child({ scope: 'huly:search-issues' })

type IssueResult = {
  id: string
  identifier: string
  title: string
  priority: number
  url: string
}

type SearchIssuesParams = {
  userId: number
  projectId: string
  query?: string
  state?: string
  labelName?: string
  labelId?: string
  dueDateBefore?: string
  dueDateAfter?: string
  estimate?: number
}

function mapPriorityToNumber(hulyPriority: number): number {
  // Huly: NoPriority=0, Low=1, Medium=2, High=3, Urgent=4
  // Output: 0=No priority, 1=Urgent, 2=High, 3=Medium, 4=Low
  const priorityMap: Record<number, number> = {
    0: 0,
    4: 1,
    3: 2,
    2: 3,
    1: 4,
  }
  return priorityMap[hulyPriority] ?? 0
}

async function resolveStateFilter(
  client: Awaited<ReturnType<typeof getHulyClient>>,
  state: string | undefined,
): Promise<IssueStatus['_id'] | undefined> {
  if (state === undefined) return undefined
  const statusQuery = await client.findAll<IssueStatus>(tracker.class.IssueStatus, { name: state })
  if (statusQuery.length > 0 && statusQuery[0] !== undefined) {
    return statusQuery[0]._id
  }
  return undefined
}

function buildDateFilter(
  dueDateBefore: string | undefined,
  dueDateAfter: string | undefined,
): { $lt?: number; $gt?: number } | undefined {
  if (dueDateBefore === undefined && dueDateAfter === undefined) return undefined
  const dateFilter: { $lt?: number; $gt?: number } = {}
  if (dueDateBefore !== undefined) {
    dateFilter.$lt = new Date(dueDateBefore).getTime()
  }
  if (dueDateAfter !== undefined) {
    dateFilter.$gt = new Date(dueDateAfter).getTime()
  }
  return dateFilter
}

function buildHulyQuery(
  params: Omit<SearchIssuesParams, 'userId' | 'labelName' | 'labelId'>,
  statusId: IssueStatus['_id'] | undefined,
  dateFilter: { $lt?: number; $gt?: number } | undefined,
  projectRef: Project['_id'],
): DocumentQuery<Issue> {
  const { query, estimate } = params
  const hulyQuery: DocumentQuery<Issue> = { space: projectRef }
  if (query !== undefined && query.length > 0) {
    hulyQuery.title = { $like: `%${query}%` }
  }
  if (statusId !== undefined) {
    hulyQuery.status = statusId
  }
  if (dateFilter !== undefined) {
    hulyQuery.dueDate = dateFilter
  }
  if (estimate !== undefined) {
    hulyQuery.estimation = estimate
  }
  return hulyQuery
}

function mapToIssueResult(issues: Issue[], projectIdentifier: string): IssueResult[] {
  return issues.map((issue) => ({
    id: issue._id,
    identifier: issue.identifier,
    title: issue.title,
    priority: mapPriorityToNumber(issue.priority),
    url: `${hulyUrl}/workbench/${hulyWorkspace}/tracker/${projectIdentifier}/${issue.identifier}`,
  }))
}

function handleLabelFilter(userId: number, labelName: string | undefined, labelId: string | undefined): void {
  if (labelName !== undefined || labelId !== undefined) {
    log.warn({ userId, labelName, labelId }, 'Label filtering not fully implemented for Huly')
  }
}

export async function searchIssues({
  userId,
  projectId,
  query,
  state,
  labelName,
  labelId,
  dueDateBefore,
  dueDateAfter,
  estimate,
}: SearchIssuesParams): Promise<IssueResult[]> {
  log.debug(
    { userId, projectId, query, state, labelName, labelId, dueDateBefore, dueDateAfter, estimate },
    'searchIssues called',
  )

  ensureRef<Project>(projectId)

  const client = await getHulyClient(userId)
  try {
    const statusId = await resolveStateFilter(client, state)
    const dateFilter = buildDateFilter(dueDateBefore, dueDateAfter)
    const hulyQuery = buildHulyQuery(
      { projectId, query, state, dueDateBefore, dueDateAfter, estimate },
      statusId,
      dateFilter,
      projectId,
    )
    const issues = await client.findAll<Issue>(tracker.class.Issue, hulyQuery, {
      sort: { modifiedOn: SortingOrder.Descending },
    })
    handleLabelFilter(userId, labelName, labelId)
    const project = await client.findOne<Project>(tracker.class.Project, { _id: projectId })
    const projectIdentifier = project?.identifier ?? 'UNK'
    const results = mapToIssueResult(issues, projectIdentifier)
    log.info({ userId, projectId, query, state, resultCount: results.length }, 'Issues searched')
    return results
  } catch (error) {
    log.error(
      { error: error instanceof Error ? error.message : String(error), userId, projectId, query },
      'searchIssues failed',
    )
    throw classifyHulyError(error)
  } finally {
    await client.close()
  }
}
