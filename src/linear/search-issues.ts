import { type Issue, type IssueSearchResult, LinearClient } from '@linear/sdk'

import { logger } from '../logger.js'
import { classifyLinearError } from './classify-error.js'
import { filterPresentNodes } from './response-guards.js'

const log = logger.child({ scope: 'linear:search-issues' })

type IssueResult = { id: string; identifier: string; title: string; priority: number; url: string }

type SearchIssuesParams = {
  apiKey: string
  query?: string
  state?: string
  projectId?: string
  labelName?: string
  labelId?: string
  dueDateBefore?: string
  dueDateAfter?: string
  estimate?: number
  hasRelations?: boolean
  relationType?: 'blocks' | 'blockedBy' | 'duplicate' | 'related'
}

const toIssueResult = (issue: Issue | IssueSearchResult): IssueResult => ({
  id: issue.id,
  identifier: issue.identifier,
  title: issue.title,
  priority: issue.priority,
  url: issue.url,
})

const filterIssuesByState = async (
  issues: (Issue | IssueSearchResult)[],
  state: string,
): Promise<(Issue | IssueSearchResult)[]> => {
  const filtered = await Promise.all(
    issues.map(async (issue) => {
      const issueState = await issue.state
      if (!issueState) {
        log.warn({ issueId: issue.id, issueIdentifier: issue.identifier }, 'Issue has no state while filtering')
        return undefined
      }
      return issueState.name.toLowerCase() === state.toLowerCase() ? issue : undefined
    }),
  )
  return filtered.filter((issue): issue is Issue | IssueSearchResult => issue !== undefined)
}

const buildIssueFilter = (params: Omit<SearchIssuesParams, 'apiKey'>): Record<string, unknown> | undefined => {
  const filter: Record<string, unknown> = {}

  if (params.projectId !== undefined) {
    filter['project'] = { id: { eq: params.projectId } }
  }

  if (params.labelName !== undefined) {
    filter['labels'] = { name: { eq: params.labelName } }
  } else if (params.labelId !== undefined) {
    filter['labels'] = { id: { eq: params.labelId } }
  }

  if (params.dueDateBefore !== undefined || params.dueDateAfter !== undefined) {
    const dueDateFilter: Record<string, string> = {}
    if (params.dueDateBefore !== undefined) {
      dueDateFilter['lt'] = params.dueDateBefore
    }
    if (params.dueDateAfter !== undefined) {
      dueDateFilter['gt'] = params.dueDateAfter
    }
    filter['dueDate'] = dueDateFilter
  }

  if (params.estimate !== undefined) {
    filter['estimate'] = { eq: params.estimate }
  }

  if (params.hasRelations === true) {
    if (params.relationType === 'blocks') {
      filter['hasBlockingRelations'] = { eq: true }
    } else if (params.relationType === 'blockedBy') {
      filter['hasBlockedByRelations'] = { eq: true }
    } else if (params.relationType === 'duplicate') {
      filter['hasDuplicateRelations'] = { eq: true }
    } else if (params.relationType === 'related') {
      filter['hasRelatedRelations'] = { eq: true }
    } else {
      filter['or'] = [
        { hasBlockingRelations: { eq: true } },
        { hasBlockedByRelations: { eq: true } },
        { hasDuplicateRelations: { eq: true } },
        { hasRelatedRelations: { eq: true } },
      ]
    }
  }

  return Object.keys(filter).length > 0 ? filter : undefined
}

const isIssue = (issue: Issue | IssueSearchResult): issue is Issue => {
  // Issue has labels() method, IssueSearchResult does not
  return 'labels' in issue && typeof issue.labels === 'function'
}

const searchByQuery = async (client: LinearClient, query: string): Promise<(Issue | IssueSearchResult)[]> => {
  const result = await client.searchIssues(query, { includeArchived: false })
  const rawResultCount = result.nodes.length
  const issues = filterPresentNodes(result.nodes, { entityName: 'issue', parentId: query }).flatMap((issue) => {
    if (
      typeof issue.id !== 'string' ||
      typeof issue.identifier !== 'string' ||
      typeof issue.title !== 'string' ||
      typeof issue.priority !== 'number' ||
      typeof issue.url !== 'string'
    ) {
      log.warn({ query, issueId: issue.id }, 'Skipping issue with invalid response shape')
      return []
    }
    return [issue]
  })
  log.debug({ query, rawResultCount, validResultCount: issues.length }, 'Linear search completed')
  return issues
}

const searchByFilter = async (
  client: LinearClient,
  filter: Record<string, unknown>,
): Promise<(Issue | IssueSearchResult)[]> => {
  const result = await client.issues({ filter })
  const issues = filterPresentNodes(result.nodes, { entityName: 'issue', parentId: 'filter-query' }).flatMap(
    (issue) => {
      if (
        typeof issue.id !== 'string' ||
        typeof issue.identifier !== 'string' ||
        typeof issue.title !== 'string' ||
        typeof issue.priority !== 'number' ||
        typeof issue.url !== 'string'
      ) {
        log.warn({ filter, issueId: issue.id }, 'Skipping issue with invalid response shape')
        return []
      }
      return [issue]
    },
  )
  log.debug({ filter, resultCount: issues.length }, 'Linear issues filter query completed')
  return issues
}

const fetchIssueLabels = async (client: LinearClient, issueId: string): Promise<{ id: string; name: string }[]> => {
  const issue = await client.issue(issueId)
  if (issue === null) return []
  const labelsResult = await issue.labels()
  return labelsResult.nodes
}

const filterByLabel = async (
  client: LinearClient,
  issues: (Issue | IssueSearchResult)[],
  labelValue: string,
  byId: boolean,
): Promise<Issue[]> => {
  const filtered = await Promise.all(
    issues.map(async (issue) => {
      // IssueSearchResult doesn't have labels() method, so we need to fetch the full issue
      const labels = isIssue(issue) ? (await issue.labels()).nodes : await fetchIssueLabels(client, issue.id)
      const hasLabel = labels.some((label: { id: string; name: string }) =>
        byId ? label.id === labelValue : label.name.toLowerCase() === labelValue.toLowerCase(),
      )
      if (!hasLabel) return undefined
      if (isIssue(issue)) return issue
      return client.issue(issue.id)
    }),
  )
  return filtered.filter((issue): issue is Issue => issue !== undefined)
}

const applyPostSearchFilters = async (
  client: LinearClient,
  issues: (Issue | IssueSearchResult)[],
  params: Omit<SearchIssuesParams, 'apiKey'>,
): Promise<(Issue | IssueSearchResult)[]> => {
  let filtered: (Issue | IssueSearchResult)[] = issues
  const { query, state, projectId, labelName, labelId } = params

  if (state !== undefined) {
    filtered = await filterIssuesByState(filtered, state)
  }

  if (projectId !== undefined && query !== undefined && query.length > 0) {
    filtered = filtered.filter((issue) => issue.projectId === projectId)
  }

  if (labelName !== undefined && query !== undefined && query.length > 0) {
    filtered = await filterByLabel(client, filtered, labelName, false)
  }

  if (labelId !== undefined && query !== undefined && query.length > 0) {
    filtered = await filterByLabel(client, filtered, labelId, true)
  }

  return filtered
}

type FilterParams = Omit<SearchIssuesParams, 'apiKey'>

const searchWithFilter = (client: LinearClient, params: FilterParams): Promise<(Issue | IssueSearchResult)[]> => {
  const filter = buildIssueFilter(params)

  if (filter === undefined) {
    log.warn({}, 'No query or filters provided for search')
    return Promise.resolve([])
  }

  return searchByFilter(client, filter)
}

const executeSearch = async (client: LinearClient, params: FilterParams): Promise<(Issue | IssueSearchResult)[]> => {
  const { query } = params

  const issues =
    query !== undefined && query.length > 0
      ? await searchByQuery(client, query)
      : await searchWithFilter(client, params)

  return applyPostSearchFilters(client, issues, params)
}

export async function searchIssues({
  apiKey,
  query,
  state,
  projectId,
  labelName,
  labelId,
  dueDateBefore,
  dueDateAfter,
  estimate,
  hasRelations,
  relationType,
}: SearchIssuesParams): Promise<IssueResult[]> {
  log.debug(
    { query, state, projectId, labelName, labelId, dueDateBefore, dueDateAfter, estimate, hasRelations, relationType },
    'searchIssues called',
  )

  try {
    const client = new LinearClient({ apiKey })
    const issues = await executeSearch(client, {
      query,
      state,
      projectId,
      labelName,
      labelId,
      dueDateBefore,
      dueDateAfter,
      estimate,
      hasRelations,
      relationType,
    })

    const mappedIssues = issues.map(toIssueResult)
    log.info({ query, state, projectId, labelName, labelId, resultCount: mappedIssues.length }, 'Issues searched')
    return mappedIssues
  } catch (error) {
    log.error(
      { error: error instanceof Error ? error.message : String(error), query, state, projectId },
      'searchIssues failed',
    )
    throw classifyLinearError(error)
  }
}
