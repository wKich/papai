import { logger } from '../../logger.js'
import { classifyKaneoError } from './classify-error.js'
import { type KaneoConfig } from './client.js'
import { KaneoClient } from './kaneo-client.js'
import { type Project } from './schemas/update-project.js'

const log = logger.child({ scope: 'kaneo:list-projects' })

export type KaneoProject = Project

export async function listProjects({
  config,
  workspaceId,
}: {
  config: KaneoConfig
  workspaceId: string
}): Promise<KaneoProject[]> {
  log.debug({ workspaceId }, 'listProjects called')

  try {
    const client = new KaneoClient(config)
    const projects = await client.projects.list(workspaceId)
    log.info({ workspaceId, projectCount: projects.length }, 'Projects listed')
    return projects
  } catch (error) {
    log.error({ error: error instanceof Error ? error.message : String(error), workspaceId }, 'listProjects failed')
    throw classifyKaneoError(error)
  }
}
