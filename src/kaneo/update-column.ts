import { z } from 'zod'

import { logger } from '../logger.js'
import { type KaneoConfig, KaneoColumnSchema } from './client.js'
import { KaneoClient } from './kaneo-client.js'

const log = logger.child({ scope: 'kaneo:update-column' })

export async function updateColumn({
  config,
  columnId,
  name,
  icon,
  color,
  isFinal,
}: {
  config: KaneoConfig
  columnId: string
  name?: string
  icon?: string
  color?: string
  isFinal?: boolean
}): Promise<z.infer<typeof KaneoColumnSchema>> {
  log.debug(
    { columnId, hasName: name !== undefined, hasIcon: icon !== undefined, hasColor: color !== undefined, isFinal },
    'updateColumn called',
  )

  try {
    const client = new KaneoClient(config)
    const column = await client.columns.update(columnId, { name, icon, color, isFinal })
    log.info({ columnId, name: column.name }, 'Column updated')
    return column
  } catch (error) {
    log.error({ error: error instanceof Error ? error.message : String(error), columnId }, 'updateColumn failed')
    throw error
  }
}
