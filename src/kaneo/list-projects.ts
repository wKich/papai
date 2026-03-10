import { z } from 'zod'

import { logger } from '../logger.js'
import { classifyKaneoError } from './classify-error.js'
import { type KaneoConfig, KaneoProjectSchema, kaneoFetch } from './client.js'

const log = logger.child({ scope: 'kaneo:list-projects' })

export type KaneoProject = z.infer<typeof KaneoProjectSchema>

export async function listProjects({
  config,
  workspaceId,
}: {
  config: KaneoConfig
  workspaceId: string
}): Promise<KaneoProject[]> {
  log.debug({ workspaceId }, 'listProjects called')

  try {
    const projects = await kaneoFetch(
      config,
      'GET',
      '/project',
      undefined,
      { workspaceId },
      z.array(KaneoProjectSchema),
    )
    log.info({ workspaceId, projectCount: projects.length }, 'Projects listed')
    return projects
  } catch (error) {
    log.error({ error: error instanceof Error ? error.message : String(error), workspaceId }, 'listProjects failed')
    throw classifyKaneoError(error)
  }
}
