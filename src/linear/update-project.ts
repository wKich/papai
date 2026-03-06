import { LinearClient } from '@linear/sdk'

import { linearError } from '../errors.js'
import { logger } from '../logger.js'
import { classifyHulyError, HulyApiError } from './classify-error.js'
import { requireEntity } from './response-guards.js'

const log = logger.child({ scope: 'linear:update-project' })

export async function updateProject({
  apiKey,
  projectId,
  name,
  description,
}: {
  apiKey: string
  projectId: string
  name?: string
  description?: string
}): Promise<{ id: string; name: string; url: string }> {
  log.debug(
    { projectId, hasName: name !== undefined, hasDescription: description !== undefined },
    'updateProject called',
  )

  // Validate that at least one field is provided
  if (name === undefined && description === undefined) {
    throw new HulyApiError(
      'At least one field (name or description) must be provided to update a project',
      linearError.validationFailed('fields', 'No update fields provided'),
    )
  }

  try {
    const client = new LinearClient({ apiKey })
    const payload = await client.updateProject(projectId, {
      name,
      description,
    })
    const project = requireEntity(await payload.project, {
      entityName: 'project',
      context: { projectId },
      appError: linearError.projectNotFound(projectId),
    })
    log.info({ projectId, name: project.name }, 'Project updated')
    return { id: project.id, name: project.name, url: project.url }
  } catch (error) {
    log.error({ error: error instanceof Error ? error.message : String(error), projectId }, 'updateProject failed')
    throw classifyHulyError(error)
  }
}
