import { logger } from '../logger.js'
import { classifyKaneoError } from './classify-error.js'
import { type KaneoConfig, kaneoFetch } from './client.js'

const log = logger.child({ scope: 'kaneo:create-task' })

interface KaneoTask {
  id: string
  title: string
  number: number
  status: string
  priority: string
}

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
}): Promise<KaneoTask> {
  log.debug({ projectId, title, priority, dueDate }, 'createTask called')

  try {
    const task = await kaneoFetch<KaneoTask>(config, 'POST', `/task/${projectId}`, {
      title,
      description: description ?? '',
      priority: priority ?? 'no-priority',
      status: status ?? 'todo',
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
