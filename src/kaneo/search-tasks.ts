import { z } from 'zod'

import { logger } from '../logger.js'
import { classifyKaneoError } from './classify-error.js'
import { type KaneoConfig, kaneoFetch } from './client.js'

const log = logger.child({ scope: 'kaneo:search-tasks' })

const TaskResultSchema = z.object({
  id: z.string(),
  title: z.string(),
  number: z.number(),
  status: z.string(),
  priority: z.string(),
})

const SearchResultSchema = z.object({
  tasks: z.array(TaskResultSchema),
})

type TaskResult = z.infer<typeof TaskResultSchema>

export async function searchTasks({
  config,
  query,
  workspaceId,
  projectId,
}: {
  config: KaneoConfig
  query: string
  workspaceId: string
  projectId?: string
}): Promise<TaskResult[]> {
  log.debug({ query, workspaceId, projectId }, 'searchTasks called')

  try {
    const queryParams: Record<string, string> = {
      q: query,
      type: 'tasks',
      workspaceId,
    }
    if (projectId !== undefined) {
      queryParams['projectId'] = projectId
    }

    const result = await kaneoFetch(config, 'GET', '/search', undefined, queryParams, SearchResultSchema)
    const tasks = result.tasks ?? []
    log.info({ query, resultCount: tasks.length }, 'Tasks searched')
    return tasks
  } catch (error) {
    log.error({ error: error instanceof Error ? error.message : String(error), query }, 'searchTasks failed')
    throw classifyKaneoError(error)
  }
}
