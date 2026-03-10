import { z } from 'zod'

import { logger } from '../logger.js'
import { classifyKaneoError } from './classify-error.js'
import { type KaneoConfig, kaneoFetch } from './client.js'

const log = logger.child({ scope: 'kaneo:remove-label' })

export async function removeLabel({
  config,
  labelId,
}: {
  config: KaneoConfig
  labelId: string
}): Promise<{ id: string; success: true }> {
  log.debug({ labelId }, 'removeLabel called')

  try {
    await kaneoFetch(config, 'DELETE', `/label/${labelId}`, undefined, undefined, z.unknown())
    log.info({ labelId }, 'Label removed')
    return { id: labelId, success: true }
  } catch (error) {
    log.error({ error: error instanceof Error ? error.message : String(error), labelId }, 'removeLabel failed')
    throw classifyKaneoError(error)
  }
}
