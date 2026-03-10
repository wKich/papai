import { logger } from '../logger.js'
import { classifyKaneoError } from './classify-error.js'
import { type KaneoConfig, kaneoFetch } from './client.js'

const log = logger.child({ scope: 'kaneo:list-tasks' })

interface KaneoTask {
  id: string
  title: string
  number: number
  status: string
  priority: string
  dueDate: string | null
}

export async function listTasks({
  config,
  projectId,
}: {
  config: KaneoConfig
  projectId: string
}): Promise<KaneoTask[]> {
  log.debug({ projectId }, 'listTasks called')

  try {
    const tasks = await kaneoFetch<KaneoTask[]>(config, 'GET', `/task/tasks/${projectId}`)
    log.info({ projectId, taskCount: tasks.length }, 'Tasks listed')
    return tasks
  } catch (error) {
    log.error({ error: error instanceof Error ? error.message : String(error), projectId }, 'listTasks failed')
    throw classifyKaneoError(error)
  }
}
