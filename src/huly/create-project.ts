/* oxlint-disable @typescript-eslint/no-unsafe-type-assertion */
import core, { generateId } from '@hcengineering/core'
import tracker from '@hcengineering/tracker'

import { logger } from '../logger.js'
import { classifyHulyError } from './classify-error.js'
import { getHulyClient } from './huly-client.js'

const log = logger.child({ scope: 'huly:create-project' })

export interface CreateProjectParams {
  userId: number
  name: string
  identifier: string
  description?: string
}

export interface ProjectResult {
  id: string
  name: string
  identifier: string
  url: string
}

export async function createProject({
  userId,
  name,
  identifier,
  description,
}: CreateProjectParams): Promise<ProjectResult> {
  log.debug({ userId, name, identifier, hasDescription: description !== undefined }, 'createProject called')

  const client = await getHulyClient(userId)

  try {
    const projectId = generateId()

    await client.createDoc(
      tracker.class.Project,
      core.space.Space,
      {
        name,
        identifier: identifier.toUpperCase(),
        description: description ?? '',
        private: false,
        defaultIssueStatus: null,
        members: [],
      },
      projectId,
    )

    log.info({ projectId, name, identifier }, 'Project created')

    const hulyUrl = process.env['HULY_URL'] ?? ''
    const hulyWorkspace = process.env['HULY_WORKSPACE'] ?? ''

    return {
      id: projectId,
      name,
      identifier: identifier.toUpperCase(),
      url: `${hulyUrl}/workbench/${hulyWorkspace}/tracker/${identifier.toUpperCase()}`,
    }
  } catch (error) {
    log.error({ error: error instanceof Error ? error.message : String(error), userId, name }, 'createProject failed')
    throw classifyHulyError(error)
  } finally {
    await client.close()
  }
}
