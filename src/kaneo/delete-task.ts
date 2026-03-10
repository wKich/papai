import { logger } from '../logger.js'
import { classifyKaneoError } from './classify-error.js'
import { type KaneoConfig, kaneoFetch } from './client.js'

const log = logger.child({ scope: 'kaneo:delete-task' })

export async function deleteTask({
  config,
  taskId,
}: {
  config: KaneoConfig
  taskId: string
}): Promise<{ id: string; success: true }> {
  log.debug({ taskId }, 'deleteTask called')

  try {
    await kaneoFetch<unknown>(config, 'DELETE', `/task/${taskId}`)
    log.info({ taskId }, 'Task deleted')
    return { id: taskId, success: true }
  } catch (error) {
    log.error({ error: error instanceof Error ? error.message : String(error), taskId }, 'deleteTask failed')
    throw classifyKaneoError(error)
  }
}
