import { z } from 'zod'

import { logger } from '../logger.js'
import { classifyKaneoError } from './classify-error.js'
import { type KaneoConfig, KaneoLabelSchema, kaneoFetch } from './client.js'

const log = logger.child({ scope: 'kaneo:add-task-label' })

const KaneoLabelWithTaskSchema = KaneoLabelSchema.extend({
  taskId: z.string().optional(),
})

export type KaneoLabel = z.infer<typeof KaneoLabelSchema>

export async function addTaskLabel({
  config,
  taskId,
  labelId,
  workspaceId,
}: {
  config: KaneoConfig
  taskId: string
  labelId: string
  workspaceId: string
}): Promise<{ taskId: string; labelId: string }> {
  log.debug({ taskId, labelId }, 'addTaskLabel called')

  try {
    // Get the label details to know its name and color
    const label = await kaneoFetch(config, 'GET', `/label/${labelId}`, undefined, undefined, KaneoLabelSchema)

    // Create a label instance attached to the task
    await kaneoFetch(
      config,
      'POST',
      '/label',
      {
        name: label.name,
        color: label.color,
        workspaceId,
        taskId,
      },
      undefined,
      KaneoLabelWithTaskSchema,
    )

    log.info({ taskId, labelId }, 'Label added to task')
    return { taskId, labelId }
  } catch (error) {
    log.error({ error: error instanceof Error ? error.message : String(error), taskId, labelId }, 'addTaskLabel failed')
    throw classifyKaneoError(error)
  }
}
