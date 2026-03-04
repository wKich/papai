import { type Issue, LinearClient } from '@linear/sdk'

import { logger } from '../logger.js'
import { classifyLinearError } from './classify-error.js'
import { filterPresentNodes } from './response-guards.js'

type IssueResult = { id: string; identifier: string; title: string; priority: number; url: string }

const toIssueResult = (issue: Issue): IssueResult => ({
  id: issue.id,
  identifier: issue.identifier,
  title: issue.title,
  priority: issue.priority,
  url: issue.url,
})

export async function searchIssues({
  apiKey,
  query,
  state,
}: {
  apiKey: string
  query: string
  state?: string
}): Promise<IssueResult[]> {
  logger.debug({ query, state, includeArchived: false }, 'searchIssues called')

  try {
    const client = new LinearClient({ apiKey })
    const result = await client.issueSearch({ query, includeArchived: false })
    const rawResultCount = result.nodes.length
    const issues = filterPresentNodes(result.nodes, { entityName: 'issue', parentId: query }).flatMap((issue) => {
      if (
        typeof issue.id !== 'string' ||
        typeof issue.identifier !== 'string' ||
        typeof issue.title !== 'string' ||
        typeof issue.priority !== 'number' ||
        typeof issue.url !== 'string'
      ) {
        logger.warn({ query, issueId: issue.id }, 'Skipping issue with invalid response shape')
        return []
      }
      return [issue]
    })
    logger.debug({ query, rawResultCount, validResultCount: issues.length }, 'Linear search completed')

    if (state !== undefined) {
      const filtered = await Promise.all(
        issues.map(async (issue) => {
          const issueState = await issue.state
          if (!issueState) {
            logger.warn({ issueId: issue.id, issueIdentifier: issue.identifier }, 'Issue has no state while filtering')
            return undefined
          }
          return issueState.name.toLowerCase() === state.toLowerCase() ? issue : undefined
        }),
      )
      const filteredIssues = filtered
        .filter((issue): issue is Issue => issue !== undefined)
        .map((issue) => toIssueResult(issue))
      logger.info({ query, state, resultCount: filteredIssues.length }, 'Issues searched')
      return filteredIssues
    }

    const mappedIssues = issues.map(toIssueResult)
    logger.info({ query, resultCount: mappedIssues.length }, 'Issues searched')
    return mappedIssues
  } catch (error) {
    logger.error({ error: error instanceof Error ? error.message : String(error), query, state }, 'searchIssues failed')
    throw classifyLinearError(error)
  }
}
