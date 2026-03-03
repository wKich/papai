import { LinearClient } from '@linear/sdk'

import { logger } from '../logger.js'
import { classifyLinearError } from './classify-error.js'

export async function createProject({
  apiKey,
  teamId,
  name,
  description,
}: {
  apiKey: string
  teamId: string
  name: string
  description?: string
}): Promise<{ id: string; name: string; url: string }> {
  logger.debug({ teamId, name, hasDescription: description !== undefined }, 'createProject called')

  try {
    const client = new LinearClient({ apiKey })
    const payload = await client.createProject({ teamIds: [teamId], name, description })
    const project = await payload.project
    if (!project) {
      throw new Error('No project returned')
    }
    logger.info({ teamId, projectId: project.id, name }, 'Project created')
    return { id: project.id, name: project.name, url: project.url }
  } catch (error) {
    logger.error(
      { error: error instanceof Error ? error.message : String(error), teamId, name },
      'createProject failed',
    )
    throw classifyLinearError(error)
  }
}
