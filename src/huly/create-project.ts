import core, { generateId } from '@hcengineering/core'
import tracker from '@hcengineering/tracker'

import { logger } from '../logger.js'
import { hulyUrl, hulyWorkspace } from './env.js'
import { getHulyClient } from './huly-client.js'
import { withClient } from './utils/with-client.js'

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

export function createProject({ userId, name, identifier, description }: CreateProjectParams): Promise<ProjectResult> {
  log.debug({ userId, name, identifier, hasDescription: description !== undefined }, 'createProject called')

  return withClient(userId, getHulyClient, async (client) => {
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

    return {
      id: projectId,
      name,
      identifier: identifier.toUpperCase(),
      url: `${hulyUrl}/workbench/${hulyWorkspace}/tracker/${identifier.toUpperCase()}`,
    }
  })
}
