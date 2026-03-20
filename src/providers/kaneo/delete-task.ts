import { logger } from '../../logger.js'
import { classifyKaneoError } from './classify-error.js'
import { type KaneoConfig } from './client.js'
import { KaneoClient } from './kaneo-client.js'

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
    const client = new KaneoClient(config)
    const result = await client.tasks.delete(taskId)
    log.info({ taskId }, 'Task deleted')
    return result
  } catch (error) {
    log.error({ error: error instanceof Error ? error.message : String(error), taskId }, 'deleteTask failed')
    throw classifyKaneoError(error, { taskId })
  }
}
