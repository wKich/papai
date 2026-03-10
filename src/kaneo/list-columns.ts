import { z } from 'zod'

import { logger } from '../logger.js'
import { classifyKaneoError } from './classify-error.js'
import { type KaneoConfig, KaneoColumnSchema, kaneoFetch } from './client.js'

const log = logger.child({ scope: 'kaneo:list-columns' })

export type KaneoColumn = z.infer<typeof KaneoColumnSchema>

export async function listColumns({
  config,
  projectId,
}: {
  config: KaneoConfig
  projectId: string
}): Promise<KaneoColumn[]> {
  log.debug({ projectId }, 'listColumns called')

  try {
    const columns = await kaneoFetch(
      config,
      'GET',
      `/column/${projectId}`,
      undefined,
      undefined,
      z.array(KaneoColumnSchema),
    )
    log.info({ projectId, columnCount: columns.length }, 'Columns listed')
    return columns
  } catch (error) {
    log.error({ error: error instanceof Error ? error.message : String(error), projectId }, 'listColumns failed')
    throw classifyKaneoError(error)
  }
}
