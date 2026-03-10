import { kaneoError } from '../errors.js'
import { logger } from '../logger.js'
import { classifyKaneoError, KaneoClassifiedError } from './classify-error.js'
import { type KaneoConfig, kaneoFetch } from './client.js'

const log = logger.child({ scope: 'kaneo:update-project' })

interface KaneoProject {
  id: string
  name: string
  slug: string
}

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
}): Promise<{ id: string; name: string; slug: string }> {
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
    const body: Record<string, string> = {}
    if (name !== undefined) body['name'] = name
    if (description !== undefined) body['description'] = description

    const project = await kaneoFetch<KaneoProject>(config, 'PUT', `/project/${projectId}`, body)
    log.info({ projectId, name: project.name }, 'Project updated')
    return { id: project.id, name: project.name, slug: project.slug }
  } catch (error) {
    log.error({ error: error instanceof Error ? error.message : String(error), projectId }, 'updateProject failed')
    throw classifyKaneoError(error)
  }
}
