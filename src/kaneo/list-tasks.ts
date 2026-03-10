import { z } from 'zod'

import { logger } from '../logger.js'
import { classifyKaneoError } from './classify-error.js'
import { type KaneoConfig, KaneoTaskSchema } from './client.js'
import { KaneoClient } from './kaneo-client.js'

const log = logger.child({ scope: 'kaneo:list-tasks' })

const KaneoTaskListItemSchema = KaneoTaskSchema.extend({
  dueDate: z.string().nullable(),
})

export type KaneoTaskListItem = z.infer<typeof KaneoTaskListItemSchema>

export async function listTasks({
  config,
  projectId,
}: {
  config: KaneoConfig
  projectId: string
}): Promise<KaneoTaskListItem[]> {
  log.debug({ projectId }, 'listTasks called')

  try {
    const client = new KaneoClient(config)
    const tasks = await client.tasks.list(projectId)
    log.info({ projectId, taskCount: tasks.length }, 'Tasks listed')
    return tasks
  } catch (error) {
    log.error({ error: error instanceof Error ? error.message : String(error), projectId }, 'listTasks failed')
    throw classifyKaneoError(error)
  }
}
