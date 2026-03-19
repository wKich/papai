import { logger } from '../../logger.js'
import { classifyKaneoError } from './classify-error.js'
import { type KaneoConfig } from './client.js'
import { KaneoClient } from './kaneo-client.js'

const log = logger.child({ scope: 'kaneo:remove-task-label' })

export async function removeTaskLabel({
  config,
  taskId,
  labelId,
}: {
  config: KaneoConfig
  taskId: string
  labelId: string
}): Promise<{ taskId: string; labelId: string; success: true }> {
  log.debug({ taskId, labelId }, 'removeTaskLabel called')

  try {
    const client = new KaneoClient(config)
    const result = await client.labels.removeFromTask(taskId, labelId)
    log.info({ taskId, labelId }, 'Label removed from task')
    return result
  } catch (error) {
    log.error(
      { error: error instanceof Error ? error.message : String(error), taskId, labelId },
      'removeTaskLabel failed',
    )
    throw classifyKaneoError(error)
  }
}
