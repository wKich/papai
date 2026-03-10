import { z } from 'zod'

import { logger } from '../logger.js'
import { classifyKaneoError } from './classify-error.js'
import { type KaneoConfig, kaneoFetch } from './client.js'

const log = logger.child({ scope: 'kaneo:remove-task-label' })

const KaneoLabelMinimalSchema = z.object({
  id: z.string(),
  name: z.string(),
})

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
    const taskLabels = await kaneoFetch(
      config,
      'GET',
      `/label/task/${taskId}`,
      undefined,
      undefined,
      z.array(KaneoLabelMinimalSchema),
    )
    const matchingLabel = taskLabels.find((l) => l.id === labelId)

    if (matchingLabel !== undefined) {
      await kaneoFetch(config, 'DELETE', `/label/${matchingLabel.id}`, undefined, undefined, z.unknown())
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
