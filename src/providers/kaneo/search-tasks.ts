import { z } from 'zod'

import { logger } from '../../logger.js'
import { classifyKaneoError } from './classify-error.js'
import type { KaneoConfig } from './client.js'
import { KaneoClient } from './kaneo-client.js'
// GlobalSearchResponseCompatSchema matches the real flat API response — see api-compat.ts.
import { GlobalSearchResponseCompatSchema } from './schemas/api-compat.js'
import { SearchTaskSchema } from './schemas/global-search.js'

const log = logger.child({ scope: 'kaneo:search-tasks' })

// Simplified task result schema for search results (output shape, not API shape)
export const TaskResultSchema = SearchTaskSchema.pick({
  id: true,
  title: true,
  number: true,
  status: true,
  priority: true,
  projectId: true,
}).extend({
  userId: z.string(),
})

// Real API returns flat { results, totalCount, searchQuery } — not per-type arrays.
export const KaneoSearchResponseSchema = GlobalSearchResponseCompatSchema

export type TaskResult = z.infer<typeof TaskResultSchema>

export async function searchTasks({
  config,
  query,
  workspaceId,
  projectId,
  assigneeId,
  limit,
}: {
  config: KaneoConfig
  query: string
  workspaceId: string
  projectId?: string
  assigneeId?: string
  limit?: number
}): Promise<TaskResult[]> {
  log.debug({ query, workspaceId, projectId, assigneeId }, 'searchTasks called')

  try {
    const client = new KaneoClient(config)
    const tasks = await client.tasks.search({ query, workspaceId, projectId, assigneeId, limit })
    log.info({ query, resultCount: tasks.length, assigneeId }, 'Tasks searched')
    return tasks
  } catch (error) {
    log.error({ error: error instanceof Error ? error.message : String(error), query }, 'searchTasks failed')
    throw classifyKaneoError(error)
  }
}
