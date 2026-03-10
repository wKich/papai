import { z } from 'zod'

import { logger } from '../logger.js'
import { classifyKaneoError } from './classify-error.js'
import { type KaneoConfig, KaneoActivitySchema } from './client.js'
import { KaneoClient } from './kaneo-client.js'

const log = logger.child({ scope: 'kaneo:add-comment' })

export type KaneoActivity = z.infer<typeof KaneoActivitySchema>

export async function addComment({
  config,
  taskId,
  comment,
}: {
  config: KaneoConfig
  taskId: string
  comment: string
}): Promise<{ id: string; comment: string; createdAt: string }> {
  log.debug({ taskId, commentLength: comment.length }, 'addComment called')

  try {
    const client = new KaneoClient(config)
    const result = await client.comments.add(taskId, comment)
    log.info({ taskId, activityId: result.id }, 'Comment added')
    return result
  } catch (error) {
    log.error({ error: error instanceof Error ? error.message : String(error), taskId }, 'addComment failed')
    throw classifyKaneoError(error)
  }
}
