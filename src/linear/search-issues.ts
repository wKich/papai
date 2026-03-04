import { type IssueSearchResult, LinearClient } from '@linear/sdk'

import { logger } from '../logger.js'
import { classifyLinearError } from './classify-error.js'
import { filterPresentNodes } from './response-guards.js'

const log = logger.child({ scope: 'linear:search-issues' })

type IssueResult = { id: string; identifier: string; title: string; priority: number; url: string }

const toIssueResult = (issue: IssueSearchResult): IssueResult => ({
  id: issue.id,
  identifier: issue.identifier,
  title: issue.title,
  priority: issue.priority,
  url: issue.url,
})

const filterIssuesByState = async (
  issues: IssueSearchResult[],
  state: string,
  query: string,
): Promise<IssueResult[]> => {
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
  const filteredIssues = filtered.filter((issue): issue is IssueSearchResult => issue !== undefined).map(toIssueResult)
  log.info({ query, state, resultCount: filteredIssues.length }, 'Issues searched')
  return filteredIssues
}

export async function searchIssues({
  apiKey,
  query,
  state,
}: {
  apiKey: string
  query: string
  state?: string
}): Promise<IssueResult[]> {
  log.debug({ query, state, includeArchived: false }, 'searchIssues called')

  try {
    const client = new LinearClient({ apiKey })
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

    if (state !== undefined) {
      return await filterIssuesByState(issues, state, query)
    }

    const mappedIssues = issues.map(toIssueResult)
    log.info({ query, resultCount: mappedIssues.length }, 'Issues searched')
    return mappedIssues
  } catch (error) {
    log.error({ error: error instanceof Error ? error.message : String(error), query, state }, 'searchIssues failed')
    throw classifyLinearError(error)
  }
}
