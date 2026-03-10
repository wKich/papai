import { logger } from '../logger.js'
import { classifyKaneoError } from './classify-error.js'
import { type KaneoConfig, kaneoFetch } from './client.js'

const log = logger.child({ scope: 'kaneo:add-comment' })

interface KaneoActivity {
  id: string
  comment: string
  createdAt: string
}

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
    const activity = await kaneoFetch<KaneoActivity>(config, 'POST', '/activity/comment', {
      taskId,
      comment,
    })
    log.info({ taskId, activityId: activity.id }, 'Comment added')
    return { id: activity.id, comment: activity.comment, createdAt: activity.createdAt }
  } catch (error) {
    log.error({ error: error instanceof Error ? error.message : String(error), taskId }, 'addComment failed')
    throw classifyKaneoError(error)
  }
}
