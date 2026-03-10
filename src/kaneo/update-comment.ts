import { z } from 'zod'

import { logger } from '../logger.js'
import { classifyKaneoError } from './classify-error.js'
import { type KaneoConfig, kaneoFetch } from './client.js'

const log = logger.child({ scope: 'kaneo:update-comment' })

const KaneoActivitySchema = z.object({
  id: z.string(),
  comment: z.string(),
})

export async function updateComment({
  config,
  activityId,
  comment,
}: {
  config: KaneoConfig
  activityId: string
  comment: string
}): Promise<{ id: string; comment: string }> {
  log.debug({ activityId, commentLength: comment.length }, 'updateComment called')

  try {
    const activity = await kaneoFetch(
      config,
      'PUT',
      '/activity/comment',
      {
        activityId,
        comment,
      },
      undefined,
      KaneoActivitySchema,
    )
    log.info({ activityId }, 'Comment updated')
    return { id: activity.id, comment: activity.comment }
  } catch (error) {
    log.error({ error: error instanceof Error ? error.message : String(error), activityId }, 'updateComment failed')
    throw classifyKaneoError(error)
  }
}
