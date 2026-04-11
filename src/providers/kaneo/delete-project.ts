import { logger } from '../../logger.js'
import { classifyKaneoError } from './classify-error.js'
import type { KaneoConfig } from './client.js'
import { KaneoClient } from './kaneo-client.js'

const log = logger.child({ scope: 'kaneo:delete-project' })

export async function deleteProject({
  config,
  projectId,
}: {
  config: KaneoConfig
  projectId: string
}): Promise<{ id: string; success: true }> {
  log.debug({ projectId }, 'deleteProject called')

  try {
    const client = new KaneoClient(config)
    const result = await client.projects.delete(projectId)
    log.info({ projectId }, 'Project deleted')
    return result
  } catch (error) {
    log.error({ error: error instanceof Error ? error.message : String(error), projectId }, 'deleteProject failed')
    throw classifyKaneoError(error)
  }
}
