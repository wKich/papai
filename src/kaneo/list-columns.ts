import { z } from 'zod'

import { logger } from '../logger.js'
import { classifyKaneoError } from './classify-error.js'
import { type KaneoConfig } from './client.js'
import { KaneoClient } from './kaneo-client.js'
import { ColumnSchema } from './schemas/listTasks.js'

const log = logger.child({ scope: 'kaneo:list-columns' })

export type KaneoColumn = z.infer<typeof ColumnSchema>

export async function listColumns({
  config,
  projectId,
}: {
  config: KaneoConfig
  projectId: string
}): Promise<KaneoColumn[]> {
  log.debug({ projectId }, 'listColumns called')

  try {
    const client = new KaneoClient(config)
    const columns = await client.columns.list(projectId)
    log.info({ projectId, columnCount: columns.length }, 'Columns listed')
    return columns
  } catch (error) {
    log.error({ error: error instanceof Error ? error.message : String(error), projectId }, 'listColumns failed')
    throw classifyKaneoError(error)
  }
}
