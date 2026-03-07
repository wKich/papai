import core, { type Ref, type Space, type DocumentUpdate } from '@hcengineering/core'
import tracker, { type Project } from '@hcengineering/tracker'

import { hulyError } from '../errors.js'
import { logger } from '../logger.js'
import { classifyHulyError, HulyApiError } from './classify-error.js'
import { hulyUrl, hulyWorkspace } from './env.js'
import { getHulyClient } from './huly-client.js'
import { ensureRef } from './refs.js'

const log = logger.child({ scope: 'huly:update-project' })

export interface UpdateProjectParams {
  userId: number
  projectId: string
  name?: string
  description?: string
}

export interface ProjectResult {
  id: string
  name: string
  identifier: string
  url: string
}

function buildUpdateFields(name: string | undefined, description: string | undefined): DocumentUpdate<Project> {
  const updates: DocumentUpdate<Project> = {}
  if (name !== undefined) {
    updates['name'] = name
  }
  if (description !== undefined) {
    updates['description'] = description
  }
  return updates
}

async function fetchProject(
  client: Awaited<ReturnType<typeof getHulyClient>>,
  projectId: Ref<Project>,
): Promise<Project> {
  const project = await client.findOne<Project>(tracker.class.Project, { _id: projectId })

  if (!project) {
    throw new Error(`Project not found: ${projectId}`)
  }

  return project
}

async function updateProjectDoc(
  client: Awaited<ReturnType<typeof getHulyClient>>,
  projectId: Ref<Project>,
  updates: DocumentUpdate<Project>,
): Promise<void> {
  await client.updateDoc(tracker.class.Project, core.space.Space as Ref<Space>, projectId, updates)
}

function buildProjectUrl(project: Project): string {
  return `${hulyUrl}/workbench/${hulyWorkspace}/tracker/${project.identifier}`
}

export async function updateProject({
  userId,
  projectId,
  name,
  description,
}: UpdateProjectParams): Promise<ProjectResult> {
  log.debug(
    { userId, projectId, hasName: name !== undefined, hasDescription: description !== undefined },
    'updateProject called',
  )

  if (name === undefined && description === undefined) {
    throw new HulyApiError(
      'At least one field (name or description) must be provided to update a project',
      hulyError.validationFailed('fields', 'No update fields provided'),
    )
  }

  const client = await getHulyClient(userId)

  ensureRef<Project>(projectId)

  try {
    const project = await fetchProject(client, projectId)
    const updates = buildUpdateFields(name, description)
    await updateProjectDoc(client, projectId, updates)

    log.info({ projectId, name: name ?? project.name }, 'Project updated')

    return {
      id: projectId,
      name: name ?? project.name,
      identifier: project.identifier,
      url: buildProjectUrl(project),
    }
  } catch (error) {
    log.error(
      { error: error instanceof Error ? error.message : String(error), userId, projectId },
      'updateProject failed',
    )
    throw classifyHulyError(error)
  } finally {
    await client.close()
  }
}
