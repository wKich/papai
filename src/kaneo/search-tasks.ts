import { z } from 'zod'

import { logger } from '../logger.js'
import { classifyKaneoError } from './classify-error.js'
import { type KaneoConfig } from './client.js'
import { KaneoClient } from './kaneo-client.js'

const log = logger.child({ scope: 'kaneo:search-tasks' })

export const TaskResultSchema = z.object({
  id: z.string(),
  title: z.string(),
  number: z.number(),
  status: z.string(),
  priority: z.string(),
})

export const TaskSearchResultSchema = z.object({
  tasks: z.array(TaskResultSchema),
})

export type TaskResult = z.infer<typeof TaskResultSchema>

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
    const client = new KaneoClient(config)
    const tasks = await client.tasks.search({ query, workspaceId, projectId })
    log.info({ query, resultCount: tasks.length }, 'Tasks searched')
    return tasks
  } catch (error) {
    log.error({ error: error instanceof Error ? error.message : String(error), query }, 'searchTasks failed')
    throw classifyKaneoError(error)
  }
}
