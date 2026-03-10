import { logger } from '../logger.js'
import { classifyKaneoError } from './classify-error.js'
import { type KaneoConfig, kaneoFetch } from './client.js'

const log = logger.child({ scope: 'kaneo:archive-project' })

export async function archiveProject({
  config,
  projectId,
}: {
  config: KaneoConfig
  projectId: string
}): Promise<{ id: string; success: true }> {
  log.debug({ projectId }, 'archiveProject called')

  try {
    await kaneoFetch<unknown>(config, 'DELETE', `/project/${projectId}`)
    log.info({ projectId }, 'Project archived (deleted)')
    return { id: projectId, success: true }
  } catch (error) {
    log.error({ error: error instanceof Error ? error.message : String(error), projectId }, 'archiveProject failed')
    throw classifyKaneoError(error)
  }
}
