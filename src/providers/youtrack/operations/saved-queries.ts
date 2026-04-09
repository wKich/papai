import { logger } from '../../../logger.js'
import type { SavedQuery, TaskSearchResult } from '../../types.js'
import { classifyYouTrackError } from '../classify-error.js'
import type { YouTrackConfig } from '../client.js'
import { youtrackFetch } from '../client.js'
import { ISSUE_LIST_FIELDS, SAVED_QUERY_FIELDS } from '../constants.js'
import { paginate } from '../helpers.js'
import { mapIssueToSearchResult, mapSavedQuery } from '../mappers.js'
import { IssueListSchema } from '../schemas/issue.js'
import { SavedQuerySchema } from '../schemas/saved-query.js'

const log = logger.child({ scope: 'provider:youtrack:saved-queries' })

export async function listYouTrackSavedQueries(config: YouTrackConfig): Promise<SavedQuery[]> {
  log.debug({}, 'listSavedQueries')
  try {
    const raw = await youtrackFetch(config, 'GET', '/api/savedQueries', {
      query: { fields: SAVED_QUERY_FIELDS, $top: '100' },
    })
    const queries = SavedQuerySchema.array().parse(raw)
    log.info({ count: queries.length }, 'Saved queries listed')
    return queries.map(mapSavedQuery)
  } catch (error) {
    log.error({ error: error instanceof Error ? error.message : String(error) }, 'Failed to list saved queries')
    throw classifyYouTrackError(error)
  }
}

export async function runYouTrackSavedQuery(config: YouTrackConfig, queryId: string): Promise<TaskSearchResult[]> {
  log.debug({ queryId }, 'runSavedQuery')
  try {
    const queryRaw = await youtrackFetch(config, 'GET', `/api/savedQueries/${queryId}`, {
      query: { fields: SAVED_QUERY_FIELDS },
    })
    const savedQuery = SavedQuerySchema.parse(queryRaw)
    const queryString = savedQuery.query ?? ''

    log.debug({ queryId, queryString }, 'Executing saved query')

    const issues = await paginate(
      config,
      '/api/issues',
      { fields: ISSUE_LIST_FIELDS, query: queryString },
      IssueListSchema.array(),
    )
    log.info({ queryId, count: issues.length }, 'Saved query executed')
    return issues.map((issue) => mapIssueToSearchResult(issue, config.baseUrl))
  } catch (error) {
    log.error({ error: error instanceof Error ? error.message : String(error), queryId }, 'Failed to run saved query')
    throw classifyYouTrackError(error)
  }
}
