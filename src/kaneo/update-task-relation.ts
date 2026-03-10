import { z } from 'zod'

import { logger } from '../logger.js'
import { classifyKaneoError } from './classify-error.js'
import { type KaneoConfig, KaneoTaskSchema, kaneoFetch } from './client.js'
import { type TaskRelation, updateRelation } from './frontmatter.js'

const log = logger.child({ scope: 'kaneo:update-task-relation' })

const KaneoTaskWithDescriptionSchema = KaneoTaskSchema.extend({
  description: z.string(),
})

export async function updateTaskRelation({
  config,
  taskId,
  relatedTaskId,
  type,
}: {
  config: KaneoConfig
  taskId: string
  relatedTaskId: string
  type: TaskRelation['type']
}): Promise<{ taskId: string; relatedTaskId: string; type: string }> {
  log.debug({ taskId, relatedTaskId, type }, 'updateTaskRelation called')

  try {
    const task = await kaneoFetch(
      config,
      'GET',
      `/task/${taskId}`,
      undefined,
      undefined,
      KaneoTaskWithDescriptionSchema,
    )
    const updatedDescription = updateRelation(task.description, relatedTaskId, type)

    await kaneoFetch(
      config,
      'PUT',
      `/task/description/${taskId}`,
      {
        description: updatedDescription,
      },
      undefined,
      KaneoTaskSchema,
    )

    log.info({ taskId, relatedTaskId, type }, 'Relation updated via frontmatter')
    return { taskId, relatedTaskId, type }
  } catch (error) {
    log.error(
      { error: error instanceof Error ? error.message : String(error), taskId, relatedTaskId },
      'updateTaskRelation failed',
    )
    throw classifyKaneoError(error)
  }
}
