import { z } from 'zod'

import { logger } from '../logger.js'
import { classifyKaneoError } from './classify-error.js'
import { type KaneoConfig, KaneoLabelSchema } from './client.js'
import { KaneoClient } from './kaneo-client.js'

const log = logger.child({ scope: 'kaneo:add-task-label' })

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
    const client = new KaneoClient(config)
    const result = await client.labels.addToTask(taskId, labelId, workspaceId)
    log.info({ taskId, labelId }, 'Label added to task')
    return result
  } catch (error) {
    log.error({ error: error instanceof Error ? error.message : String(error), taskId, labelId }, 'addTaskLabel failed')
    throw classifyKaneoError(error)
  }
}
