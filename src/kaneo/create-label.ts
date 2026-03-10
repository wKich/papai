import { z } from 'zod'

import { logger } from '../logger.js'
import { classifyKaneoError } from './classify-error.js'
import { type KaneoConfig, KaneoLabelSchema, kaneoFetch } from './client.js'

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
    const label = await kaneoFetch(
      config,
      'POST',
      '/label',
      {
        name,
        color: color ?? '#6b7280',
        workspaceId,
      },
      undefined,
      KaneoLabelSchema,
    )
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
