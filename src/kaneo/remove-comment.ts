import { z } from 'zod'

import { logger } from '../logger.js'
import { classifyKaneoError } from './classify-error.js'
import { type KaneoConfig, kaneoFetch } from './client.js'

const log = logger.child({ scope: 'kaneo:remove-comment' })

export async function removeComment({
  config,
  activityId,
}: {
  config: KaneoConfig
  activityId: string
}): Promise<{ id: string; success: true }> {
  log.debug({ activityId }, 'removeComment called')

  try {
    await kaneoFetch(config, 'DELETE', '/activity/comment', { activityId }, undefined, z.unknown())
    log.info({ activityId }, 'Comment removed')
    return { id: activityId, success: true }
  } catch (error) {
    log.error({ error: error instanceof Error ? error.message : String(error), activityId }, 'removeComment failed')
    throw classifyKaneoError(error)
  }
}
