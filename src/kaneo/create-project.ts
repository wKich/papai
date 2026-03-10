import { z } from 'zod'

import { logger } from '../logger.js'
import { classifyKaneoError } from './classify-error.js'
import { type KaneoConfig, KaneoProjectSchema, kaneoFetch } from './client.js'

const log = logger.child({ scope: 'kaneo:create-project' })

export type KaneoProject = z.infer<typeof KaneoProjectSchema>

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

  const slug = name
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '')

  try {
    const project = await kaneoFetch(
      config,
      'POST',
      '/project',
      {
        name,
        workspaceId,
        icon: '',
        slug,
      },
      undefined,
      KaneoProjectSchema,
    )

    // Update description if provided (create doesn't support description)
    if (description !== undefined) {
      await kaneoFetch(config, 'PUT', `/project/${project.id}`, { description }, undefined, KaneoProjectSchema)
    }

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
