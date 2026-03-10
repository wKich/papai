import { z } from 'zod'

import { logger } from '../logger.js'
import { classifyKaneoError } from './classify-error.js'
import { type KaneoConfig, KaneoActivityWithTypeSchema, kaneoFetch } from './client.js'

const log = logger.child({ scope: 'kaneo:get-comments' })

export type KaneoActivity = z.infer<typeof KaneoActivityWithTypeSchema>

export async function getComments({
  config,
  taskId,
}: {
  config: KaneoConfig
  taskId: string
}): Promise<{ id: string; comment: string; createdAt: string }[]> {
  log.debug({ taskId }, 'getComments called')

  try {
    const activities = await kaneoFetch(
      config,
      'GET',
      `/activity/${taskId}`,
      undefined,
      undefined,
      z.array(KaneoActivityWithTypeSchema),
    )
    const comments = activities
      .filter((a) => a.type === 'comment' && a.comment !== null)
      .map((a) => ({
        id: a.id,
        comment: a.comment!,
        createdAt: a.createdAt,
      }))
    log.info({ taskId, commentCount: comments.length }, 'Comments fetched')
    return comments
  } catch (error) {
    log.error({ error: error instanceof Error ? error.message : String(error), taskId }, 'getComments failed')
    throw classifyKaneoError(error)
  }
}
