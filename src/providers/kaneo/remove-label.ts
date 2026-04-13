import { logger } from '../../logger.js'
import { classifyKaneoError } from './classify-error.js'
import type { KaneoConfig } from './client.js'
import { KaneoClient } from './kaneo-client.js'

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
    const client = new KaneoClient(config)
    const result = await client.labels.remove(labelId)
    log.info({ labelId }, 'Label removed')
    return result
  } catch (error) {
    log.error({ error: error instanceof Error ? error.message : String(error), labelId }, 'removeLabel failed')
    throw classifyKaneoError(error)
  }
}
