import { LinearClient } from '@linear/sdk'

import { linearError } from '../errors.js'
import { logger } from '../logger.js'
import { classifyLinearError } from './classify-error.js'
import { requireEntity } from './response-guards.js'

const log = logger.child({ scope: 'linear:archive-project' })

export async function archiveProject({
  apiKey,
  projectId,
}: {
  apiKey: string
  projectId: string
}): Promise<{ id: string; success: true }> {
  log.debug({ projectId }, 'archiveProject called')

  try {
    const client = new LinearClient({ apiKey })
    const project = requireEntity(await client.project(projectId), {
      entityName: 'project',
      context: { projectId },
      appError: linearError.projectNotFound(projectId),
    })
    await project.archive()
    log.info({ projectId }, 'Project archived')
    return { id: projectId, success: true }
  } catch (error) {
    log.error({ error: error instanceof Error ? error.message : String(error), projectId }, 'archiveProject failed')
    throw classifyLinearError(error)
  }
}
