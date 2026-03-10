import { kaneoError } from '../errors.js'
import { logger } from '../logger.js'
import { classifyKaneoError, KaneoClassifiedError } from './classify-error.js'
import { type KaneoConfig, kaneoFetch } from './client.js'

const log = logger.child({ scope: 'kaneo:update-label' })

interface KaneoLabel {
  id: string
  name: string
  color: string
}

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
}): Promise<{ id: string; name: string; color: string }> {
  log.debug({ labelId, hasName: name !== undefined, hasColor: color !== undefined }, 'updateLabel called')

  if (name === undefined && color === undefined) {
    throw new KaneoClassifiedError(
      'At least one field (name or color) must be provided to update a label',
      kaneoError.validationFailed('fields', 'No update fields provided'),
    )
  }

  try {
    const body: Record<string, string> = {}
    if (name !== undefined) body['name'] = name
    if (color !== undefined) body['color'] = color

    const label = await kaneoFetch<KaneoLabel>(config, 'PUT', `/label/${labelId}`, body)
    log.info({ labelId, name: label.name }, 'Label updated')
    return { id: label.id, name: label.name, color: label.color }
  } catch (error) {
    log.error({ error: error instanceof Error ? error.message : String(error), labelId }, 'updateLabel failed')
    throw classifyKaneoError(error)
  }
}
