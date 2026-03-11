import { z } from 'zod'

import { logger } from '../logger.js'
import { classifyKaneoError } from './classify-error.js'
import { type KaneoConfig, KaneoTaskSchema, kaneoFetch } from './client.js'
import { addRelation, removeRelation, updateRelation, type TaskRelation } from './frontmatter.js'

const KaneoTaskWithDescriptionSchema = KaneoTaskSchema.extend({
  description: z.string(),
})

const log = logger.child({ scope: 'kaneo:task-relations' })

export async function addTaskRelation(
  config: KaneoConfig,
  taskId: string,
  relatedTaskId: string,
  type: TaskRelation['type'],
): Promise<{ taskId: string; relatedTaskId: string; type: string }> {
  log.debug({ taskId, relatedTaskId, type }, 'Adding task relation')

  try {
    const task = await kaneoFetch(
      config,
      'GET',
      `/task/${taskId}`,
      undefined,
      undefined,
      KaneoTaskWithDescriptionSchema,
    )
    const updatedDescription = addRelation(task.description, { type, taskId: relatedTaskId })

    await kaneoFetch(
      config,
      'PUT',
      `/task/description/${taskId}`,
      { description: updatedDescription },
      undefined,
      KaneoTaskSchema,
    )

    log.info({ taskId, relatedTaskId, type }, 'Relation added')
    return { taskId, relatedTaskId, type }
  } catch (error) {
    log.error({ error: error instanceof Error ? error.message : String(error) }, 'Failed to add relation')
    throw classifyKaneoError(error)
  }
}

export async function removeTaskRelation(
  config: KaneoConfig,
  taskId: string,
  relatedTaskId: string,
): Promise<{ taskId: string; relatedTaskId: string; success: true }> {
  log.debug({ taskId, relatedTaskId }, 'Removing task relation')

  try {
    const task = await kaneoFetch(
      config,
      'GET',
      `/task/${taskId}`,
      undefined,
      undefined,
      KaneoTaskWithDescriptionSchema,
    )
    const updatedDescription = removeRelation(task.description, relatedTaskId)

    await kaneoFetch(
      config,
      'PUT',
      `/task/description/${taskId}`,
      { description: updatedDescription },
      undefined,
      KaneoTaskSchema,
    )

    log.info({ taskId, relatedTaskId }, 'Relation removed')
    return { taskId, relatedTaskId, success: true }
  } catch (error) {
    log.error({ error: error instanceof Error ? error.message : String(error) }, 'Failed to remove relation')
    throw classifyKaneoError(error)
  }
}

export async function updateTaskRelation(
  config: KaneoConfig,
  taskId: string,
  relatedTaskId: string,
  type: TaskRelation['type'],
): Promise<{ taskId: string; relatedTaskId: string; type: string }> {
  log.debug({ taskId, relatedTaskId, type }, 'Updating task relation')

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
      { description: updatedDescription },
      undefined,
      KaneoTaskSchema,
    )

    log.info({ taskId, relatedTaskId, type }, 'Relation updated')
    return { taskId, relatedTaskId, type }
  } catch (error) {
    log.error({ error: error instanceof Error ? error.message : String(error) }, 'Failed to update relation')
    throw classifyKaneoError(error)
  }
}
