import type { CreateTaskResponse } from '../../../schemas/kaneo/create-task.js'
import { logger } from '../../logger.js'
import { classifyKaneoError } from './classify-error.js'
import { type KaneoConfig } from './client.js'
import { KaneoClient } from './kaneo-client.js'

const log = logger.child({ scope: 'kaneo:create-task' })

export async function createTask({
  config,
  projectId,
  title,
  description,
  priority,
  status,
  dueDate,
  userId,
}: {
  config: KaneoConfig
  projectId: string
  title: string
  description?: string
  priority?: string
  status?: string
  dueDate?: string
  userId?: string
}): Promise<CreateTaskResponse> {
  log.debug({ projectId, title, priority, dueDate }, 'createTask called')

  try {
    const client = new KaneoClient(config)
    const task = await client.tasks.create({
      projectId,
      title,
      description,
      priority,
      status,
      dueDate,
      userId,
    })
    log.info({ taskId: task.id, title, number: task.number }, 'Task created')
    return task
  } catch (error) {
    log.error({ error: error instanceof Error ? error.message : String(error), projectId, title }, 'createTask failed')
    throw classifyKaneoError(error)
  }
}
