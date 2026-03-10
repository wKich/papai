import { logger } from '../logger.js'
import { classifyKaneoError } from './classify-error.js'
import { type KaneoConfig, kaneoFetch } from './client.js'

const log = logger.child({ scope: 'kaneo:remove-task-label' })

interface KaneoLabel {
  id: string
  name: string
}

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
    // Get labels on this task and find the matching one
    const taskLabels = await kaneoFetch<KaneoLabel[]>(config, 'GET', `/label/task/${taskId}`)
    const matchingLabel = taskLabels.find((l) => l.id === labelId)

    if (matchingLabel !== undefined) {
      await kaneoFetch<unknown>(config, 'DELETE', `/label/${matchingLabel.id}`)
    }

    log.info({ taskId, labelId }, 'Label removed from task')
    return { taskId, labelId, success: true }
  } catch (error) {
    log.error(
      { error: error instanceof Error ? error.message : String(error), taskId, labelId },
      'removeTaskLabel failed',
    )
    throw classifyKaneoError(error)
  }
}
