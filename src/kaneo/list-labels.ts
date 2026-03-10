import { logger } from '../logger.js'
import { classifyKaneoError } from './classify-error.js'
import { type KaneoConfig, kaneoFetch } from './client.js'

const log = logger.child({ scope: 'kaneo:list-labels' })

interface KaneoLabel {
  id: string
  name: string
  color: string
}

export async function listLabels({
  config,
  workspaceId,
}: {
  config: KaneoConfig
  workspaceId: string
}): Promise<{ id: string; name: string; color: string }[]> {
  log.debug({ workspaceId }, 'listLabels called')

  try {
    const labels = await kaneoFetch<KaneoLabel[]>(config, 'GET', `/label/workspace/${workspaceId}`)
    const result = labels.map((l) => ({ id: l.id, name: l.name, color: l.color }))
    log.info({ workspaceId, labelCount: result.length }, 'Labels listed')
    return result
  } catch (error) {
    log.error({ error: error instanceof Error ? error.message : String(error), workspaceId }, 'listLabels failed')
    throw classifyKaneoError(error)
  }
}
