import { z } from 'zod'

import { ColumnCompatSchema } from '../../../schemas/kaneo/api-compat.js'
import { logger } from '../../logger.js'
import { type KaneoConfig } from './client.js'
import { KaneoClient } from './kaneo-client.js'

const log = logger.child({ scope: 'kaneo:create-column' })

type CreateColumnResponse = z.infer<typeof ColumnCompatSchema>

export async function createColumn({
  config,
  projectId,
  name,
  icon,
  color,
  isFinal,
}: {
  config: KaneoConfig
  projectId: string
  name: string
  icon?: string
  color?: string
  isFinal?: boolean
}): Promise<CreateColumnResponse> {
  log.debug(
    { projectId, name, hasIcon: icon !== undefined, hasColor: color !== undefined, isFinal },
    'createColumn called',
  )

  try {
    const client = new KaneoClient(config)
    const column = await client.columns.create(projectId, { name, icon, color, isFinal })
    log.info({ columnId: column.id, name: column.name, projectId }, 'Column created')
    return column
  } catch (error) {
    log.error({ error: error instanceof Error ? error.message : String(error), projectId, name }, 'createColumn failed')
    throw error
  }
}
