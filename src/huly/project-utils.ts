import core from '@hcengineering/core'
import { generateId } from '@hcengineering/core'
import tracker from '@hcengineering/tracker'

import { logger } from '../logger.js'
import { classifyHulyError } from './classify-error.js'

const log = logger.child({ scope: 'huly:project-utils' })

export interface ProjectQueryClient {
  findOne(classRef: unknown, query: Record<string, unknown>): Promise<unknown>
  createDoc(classRef: unknown, space: unknown, data: Record<string, unknown>, id?: string): Promise<unknown>
  getAccount(): Promise<{ uuid: string }>
}

export function formatProjectIdentifier(userIdentifier: string | number): string {
  const normalized = String(userIdentifier)
    .toUpperCase()
    .replace(/[^A-Z0-9_-]/g, '')
  return `P-${normalized}`
}

export async function getOrCreateUserProject(
  client: ProjectQueryClient,
  userIdentifier: string | number,
): Promise<{ _id: string; identifier: string }> {
  const projectIdentifier = formatProjectIdentifier(userIdentifier)
  log.debug({ projectIdentifier }, 'Looking up user project')

  const existingProject = await client.findOne(tracker.class.Project, { identifier: projectIdentifier })

  if (
    existingProject !== undefined &&
    existingProject !== null &&
    typeof existingProject === 'object' &&
    '_id' in existingProject
  ) {
    const id = existingProject['_id']
    const projectId = typeof id === 'string' ? id : ''
    log.info({ projectId, identifier: projectIdentifier }, 'Found existing project')
    return { _id: projectId, identifier: projectIdentifier }
  }

  return createUserProject(client, userIdentifier, projectIdentifier)
}

async function createUserProject(
  client: ProjectQueryClient,
  userIdentifier: string | number,
  projectIdentifier: string,
): Promise<{ _id: string; identifier: string }> {
  log.info({ identifier: projectIdentifier }, 'Creating new project for user')

  const projectId = generateId()
  const workspaceSpace = await client.findOne(core.class.Space, { _id: core.space.Workspace })

  if (workspaceSpace === undefined || workspaceSpace === null) {
    throw classifyHulyError(new Error('Workspace space not found'))
  }

  const account = await client.getAccount()

  await client.createDoc(
    tracker.class.Project,
    core.space.Space,
    {
      name: `Project ${userIdentifier}`,
      identifier: projectIdentifier,
      description: `Auto-created project for user ${userIdentifier}`,
      private: true,
      defaultIssueStatus: null,
      members: [account.uuid],
    },
    projectId,
  )

  log.info({ projectId, identifier: projectIdentifier }, 'Created new project')
  return { _id: projectId, identifier: projectIdentifier }
}
