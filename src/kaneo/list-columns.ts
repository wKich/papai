import { logger } from '../logger.js'
import { classifyKaneoError } from './classify-error.js'
import { type KaneoConfig, kaneoFetch } from './client.js'

const log = logger.child({ scope: 'kaneo:list-columns' })

interface KaneoColumn {
  id: string
  name: string
  color: string | null
  isFinal: boolean
}

export async function listColumns({
  config,
  projectId,
}: {
  config: KaneoConfig
  projectId: string
}): Promise<{ id: string; name: string; color: string | null; isFinal: boolean }[]> {
  log.debug({ projectId }, 'listColumns called')

  try {
    const columns = await kaneoFetch<KaneoColumn[]>(config, 'GET', `/column/${projectId}`)
    log.info({ projectId, columnCount: columns.length }, 'Columns listed')
    return columns.map((c) => ({ id: c.id, name: c.name, color: c.color, isFinal: c.isFinal }))
  } catch (error) {
    log.error({ error: error instanceof Error ? error.message : String(error), projectId }, 'listColumns failed')
    throw classifyKaneoError(error)
  }
}
