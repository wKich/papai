import { z } from 'zod'

import { logger } from '../logger.js'
import { classifyKaneoError } from './classify-error.js'
import { type KaneoConfig, KaneoLabelSchema } from './client.js'
import { KaneoClient } from './kaneo-client.js'

const log = logger.child({ scope: 'kaneo:create-label' })

export type KaneoLabel = z.infer<typeof KaneoLabelSchema>

export async function createLabel({
  config,
  workspaceId,
  name,
  color,
}: {
  config: KaneoConfig
  workspaceId: string
  name: string
  color?: string
}): Promise<KaneoLabel> {
  log.debug({ workspaceId, name, hasColor: color !== undefined }, 'createLabel called')

  try {
    const client = new KaneoClient(config)
    const label = await client.labels.create({ workspaceId, name, color })
    log.info({ workspaceId, labelId: label.id, name }, 'Label created')
    return label
  } catch (error) {
    log.error(
      { error: error instanceof Error ? error.message : String(error), workspaceId, name },
      'createLabel failed',
    )
    throw classifyKaneoError(error)
  }
}
