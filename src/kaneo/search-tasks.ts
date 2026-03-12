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

// Matches the actual Kaneo search API response: { results, totalCount, searchQuery }
export const KaneoSearchResponseSchema = z.object({
  results: z.array(
    z.object({
      id: z.string(),
      type: z.string(),
      title: z.string(),
      description: z.string().optional(),
      projectId: z.string().optional(),
      taskNumber: z.number().optional(),
      priority: z.string().optional(),
      status: z.string().optional(),
      createdAt: z.string().or(z.date()),
      relevanceScore: z.number(),
    }),
  ),
  totalCount: z.number(),
  searchQuery: z.string(),
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
