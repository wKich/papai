import { logger } from '../logger.js'
import { classifyKaneoError } from './classify-error.js'
import { type KaneoConfig } from './client.js'
import { KaneoClient } from './kaneo-client.js'

const log = logger.child({ scope: 'kaneo:update-comment' })

export async function updateComment({
  config,
  activityId,
  comment,
}: {
  config: KaneoConfig
  activityId: string
  comment: string
}): Promise<{ id: string; comment: string; createdAt: string }> {
  log.debug({ activityId, commentLength: comment.length }, 'updateComment called')

  try {
    const client = new KaneoClient(config)
    const result = await client.comments.update(activityId, comment)
    log.info({ activityId }, 'Comment updated')
    return result
  } catch (error) {
    log.error({ error: error instanceof Error ? error.message : String(error), activityId }, 'updateComment failed')
    throw classifyKaneoError(error)
  }
}
