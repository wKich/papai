import { logger } from '../logger.js'
import { classifyKaneoError } from './classify-error.js'
import { type KaneoConfig, kaneoFetch } from './client.js'

const log = logger.child({ scope: 'kaneo:create-label' })

interface KaneoLabel {
  id: string
  name: string
  color: string
}

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
}): Promise<{ id: string; name: string; color: string }> {
  log.debug({ workspaceId, name, hasColor: color !== undefined }, 'createLabel called')

  try {
    const label = await kaneoFetch<KaneoLabel>(config, 'POST', '/label', {
      name,
      color: color ?? '#6b7280',
      workspaceId,
    })
    log.info({ workspaceId, labelId: label.id, name }, 'Label created')
    return { id: label.id, name: label.name, color: label.color }
  } catch (error) {
    log.error(
      { error: error instanceof Error ? error.message : String(error), workspaceId, name },
      'createLabel failed',
    )
    throw classifyKaneoError(error)
  }
}
