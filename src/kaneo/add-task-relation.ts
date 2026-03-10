import { logger } from '../logger.js'
import { classifyKaneoError } from './classify-error.js'
import { type KaneoConfig, kaneoFetch } from './client.js'
import { type TaskRelation, addRelation } from './frontmatter.js'

const log = logger.child({ scope: 'kaneo:add-task-relation' })

interface KaneoTask {
  id: string
  title: string
  description: string
}

export async function addTaskRelation({
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
  log.debug({ taskId, relatedTaskId, type }, 'addTaskRelation called')

  try {
    const task = await kaneoFetch<KaneoTask>(config, 'GET', `/task/${taskId}`)
    const updatedDescription = addRelation(task.description, { type, taskId: relatedTaskId })

    await kaneoFetch<KaneoTask>(config, 'PUT', `/task/description/${taskId}`, {
      description: updatedDescription,
    })

    log.info({ taskId, relatedTaskId, type }, 'Relation added via frontmatter')
    return { taskId, relatedTaskId, type }
  } catch (error) {
    log.error(
      { error: error instanceof Error ? error.message : String(error), taskId, relatedTaskId },
      'addTaskRelation failed',
    )
    throw classifyKaneoError(error)
  }
}
