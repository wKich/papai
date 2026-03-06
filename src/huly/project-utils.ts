import type { PlatformClient } from '@hcengineering/api-client'
import core from '@hcengineering/core'
import { generateId } from '@hcengineering/core'
import tracker from '@hcengineering/tracker'

import { logger } from '../logger.js'
import { classifyHulyError } from './classify-error.js'

const log = logger.child({ scope: 'huly:project-utils' })

export function formatProjectIdentifier(userIdentifier: string | number): string {
  const normalized = String(userIdentifier)
    .toUpperCase()
    .replace(/[^A-Z0-9_-]/g, '')
  return `P-${normalized}`
}

export async function getOrCreateUserProject(
  client: PlatformClient,
  userIdentifier: string | number,
): Promise<{ _id: string; identifier: string }> {
  const projectIdentifier = formatProjectIdentifier(userIdentifier)
  log.debug({ projectIdentifier }, 'Looking up user project')

  // Try to find existing project
  const existingProject = await client.findOne(tracker.class.Project, {
    identifier: projectIdentifier,
  })

  if (existingProject) {
    log.info({ projectId: existingProject._id, identifier: projectIdentifier }, 'Found existing project')
    return { _id: existingProject._id as string, identifier: projectIdentifier }
  }

  // Create new project
  log.info({ identifier: projectIdentifier }, 'Creating new project for user')

  const projectId = generateId()

  // Get workspace space for project creation
  const workspaceSpace = await client.findOne(core.class.Space, {
    _id: core.space.Workspace,
  })

  if (!workspaceSpace) {
    throw classifyHulyError(new Error('Workspace space not found'))
  }

  await client.createDoc(
    tracker.class.Project,
    core.space.Space,
    {
      name: `Project ${userIdentifier}`,
      identifier: projectIdentifier,
      description: `Auto-created project for user ${userIdentifier}`,
      private: false,
      // Will be set by Huly
      defaultIssueStatus: null,
      members: [],
    },
    projectId,
  )

  log.info({ projectId, identifier: projectIdentifier }, 'Created new project')

  return { _id: projectId, identifier: projectIdentifier }
}
