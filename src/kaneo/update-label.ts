import { z } from 'zod'

import { kaneoError } from '../errors.js'
import { logger } from '../logger.js'
import { classifyKaneoError, KaneoClassifiedError } from './classify-error.js'
import { type KaneoConfig, KaneoLabelSchema } from './client.js'
import { KaneoClient } from './kaneo-client.js'

const log = logger.child({ scope: 'kaneo:update-label' })

export type KaneoLabel = z.infer<typeof KaneoLabelSchema>

export async function updateLabel({
  config,
  labelId,
  name,
  color,
}: {
  config: KaneoConfig
  labelId: string
  name?: string
  color?: string
}): Promise<KaneoLabel> {
  log.debug({ labelId, hasName: name !== undefined, hasColor: color !== undefined }, 'updateLabel called')

  if (name === undefined && color === undefined) {
    throw new KaneoClassifiedError(
      'At least one field (name or color) must be provided to update a label',
      kaneoError.validationFailed('fields', 'No update fields provided'),
    )
  }

  try {
    const client = new KaneoClient(config)
    const label = await client.labels.update(labelId, { name, color })
    log.info({ labelId, name: label.name }, 'Label updated')
    return label
  } catch (error) {
    log.error({ error: error instanceof Error ? error.message : String(error), labelId }, 'updateLabel failed')
    throw classifyKaneoError(error)
  }
}
