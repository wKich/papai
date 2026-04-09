import { logger } from '../../../logger.js'
import type { Activity } from '../../types.js'
import { classifyYouTrackError } from '../classify-error.js'
import type { YouTrackConfig } from '../client.js'
import { youtrackFetch } from '../client.js'
import { ACTIVITY_FIELDS, DEFAULT_ACTIVITY_CATEGORIES } from '../constants.js'
import { mapActivity } from '../mappers.js'
import { ActivitySchema } from '../schemas/activity.js'

const log = logger.child({ scope: 'provider:youtrack:activities' })

export async function getYouTrackTaskHistory(
  config: YouTrackConfig,
  taskId: string,
  params?: {
    categories?: string[]
    limit?: number
    offset?: number
    reverse?: boolean
    start?: string
    end?: string
    author?: string
  },
): Promise<Activity[]> {
  log.debug({ taskId, params }, 'getTaskHistory')
  try {
    const query: Record<string, string> = {
      fields: ACTIVITY_FIELDS,
      categories:
        params?.categories !== undefined && params.categories.length > 0
          ? params.categories.join(',')
          : DEFAULT_ACTIVITY_CATEGORIES,
    }
    if (params?.limit !== undefined) query['$top'] = String(params.limit)
    if (params?.offset !== undefined) query['$skip'] = String(params.offset)
    if (params?.reverse !== undefined) query['reverse'] = String(params.reverse)
    if (params?.start !== undefined) query['start'] = String(new Date(params.start).getTime())
    if (params?.end !== undefined) query['end'] = String(new Date(params.end).getTime())
    if (params?.author !== undefined) query['author'] = params.author

    const raw = await youtrackFetch(config, 'GET', `/api/issues/${taskId}/activities`, {
      query,
    })
    const activities = ActivitySchema.array().parse(raw)
    log.info({ taskId, count: activities.length }, 'Task history retrieved')
    return activities.map(mapActivity)
  } catch (error) {
    log.error({ error: error instanceof Error ? error.message : String(error), taskId }, 'Failed to get task history')
    throw classifyYouTrackError(error, { taskId })
  }
}
