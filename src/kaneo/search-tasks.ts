import { logger } from '../logger.js'
import { classifyKaneoError } from './classify-error.js'
import { type KaneoConfig, kaneoFetch } from './client.js'

const log = logger.child({ scope: 'kaneo:search-tasks' })

interface SearchResult {
  tasks: Array<{
    id: string
    title: string
    number: number
    status: string
    priority: string
  }>
}

type TaskResult = {
  id: string
  title: string
  number: number
  status: string
  priority: string
}

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

    const result = await kaneoFetch<SearchResult>(config, 'GET', '/search', undefined, queryParams)
    const tasks = result.tasks ?? []
    log.info({ query, resultCount: tasks.length }, 'Tasks searched')
    return tasks
  } catch (error) {
    log.error({ error: error instanceof Error ? error.message : String(error), query }, 'searchTasks failed')
    throw classifyKaneoError(error)
  }
}
