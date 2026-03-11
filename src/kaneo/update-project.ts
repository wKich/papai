import { z } from 'zod'

import { kaneoError } from '../errors.js'
import { logger } from '../logger.js'
import { classifyKaneoError, KaneoClassifiedError } from './classify-error.js'
import { type KaneoConfig, KaneoProjectSchema } from './client.js'
import { KaneoClient } from './kaneo-client.js'

const log = logger.child({ scope: 'kaneo:update-project' })

export type KaneoProject = z.infer<typeof KaneoProjectSchema>

export async function updateProject({
  config,
  projectId,
  name,
  description,
}: {
  config: KaneoConfig
  projectId: string
  name?: string
  description?: string
}): Promise<KaneoProject> {
  log.debug(
    { projectId, hasName: name !== undefined, hasDescription: description !== undefined },
    'updateProject called',
  )

  if (name === undefined && description === undefined) {
    throw new KaneoClassifiedError(
      'At least one field (name or description) must be provided to update a project',
      kaneoError.validationFailed('fields', 'No update fields provided'),
    )
  }

  try {
    const client = new KaneoClient(config)
    const project = await client.projects.update(projectId, { name, description })
    log.info({ projectId, name: project.name }, 'Project updated')
    return project
  } catch (error) {
    log.error({ error: error instanceof Error ? error.message : String(error), projectId }, 'updateProject failed')
    throw classifyKaneoError(error)
  }
}
