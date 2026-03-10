import { logger } from '../logger.js'
import { classifyKaneoError } from './classify-error.js'
import { type KaneoConfig, kaneoFetch } from './client.js'
import { removeRelation } from './frontmatter.js'

const log = logger.child({ scope: 'kaneo:remove-task-relation' })

interface KaneoTask {
  id: string
  title: string
  description: string
}

export async function removeTaskRelation({
  config,
  taskId,
  relatedTaskId,
}: {
  config: KaneoConfig
  taskId: string
  relatedTaskId: string
}): Promise<{ taskId: string; relatedTaskId: string; success: true }> {
  log.debug({ taskId, relatedTaskId }, 'removeTaskRelation called')

  try {
    const task = await kaneoFetch<KaneoTask>(config, 'GET', `/task/${taskId}`)
    const updatedDescription = removeRelation(task.description, relatedTaskId)

    await kaneoFetch<KaneoTask>(config, 'PUT', `/task/description/${taskId}`, {
      description: updatedDescription,
    })

    log.info({ taskId, relatedTaskId }, 'Relation removed via frontmatter')
    return { taskId, relatedTaskId, success: true }
  } catch (error) {
    log.error(
      { error: error instanceof Error ? error.message : String(error), taskId, relatedTaskId },
      'removeTaskRelation failed',
    )
    throw classifyKaneoError(error)
  }
}
