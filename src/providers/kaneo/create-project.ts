import { logger } from '../../logger.js'
import { classifyKaneoError } from './classify-error.js'
import { type KaneoConfig } from './client.js'
import { KaneoClient } from './kaneo-client.js'
import { type Project } from './schemas/update-project.js'

const log = logger.child({ scope: 'kaneo:create-project' })

type KaneoProject = Project

export async function createProject({
  config,
  workspaceId,
  name,
  description,
}: {
  config: KaneoConfig
  workspaceId: string
  name: string
  description?: string
}): Promise<KaneoProject> {
  log.debug({ workspaceId, name, hasDescription: description !== undefined }, 'createProject called')

  try {
    const client = new KaneoClient(config)
    const project = await client.projects.create({ workspaceId, name, description })
    log.info({ workspaceId, projectId: project.id, name }, 'Project created')
    return project
  } catch (error) {
    log.error(
      { error: error instanceof Error ? error.message : String(error), workspaceId, name },
      'createProject failed',
    )
    throw classifyKaneoError(error)
  }
}
