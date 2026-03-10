import { logger } from '../logger.js'
import { classifyKaneoError } from './classify-error.js'
import { type KaneoConfig, kaneoFetch } from './client.js'

const log = logger.child({ scope: 'kaneo:add-task-label' })

interface KaneoLabel {
  id: string
  name: string
  color: string
}

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
    const label = await kaneoFetch<KaneoLabel>(config, 'GET', `/label/${labelId}`)

    // Create a label instance attached to the task
    await kaneoFetch<KaneoLabel>(config, 'POST', '/label', {
      name: label.name,
      color: label.color,
      workspaceId,
      taskId,
    })

    log.info({ taskId, labelId }, 'Label added to task')
    return { taskId, labelId }
  } catch (error) {
    log.error({ error: error instanceof Error ? error.message : String(error), taskId, labelId }, 'addTaskLabel failed')
    throw classifyKaneoError(error)
  }
}
