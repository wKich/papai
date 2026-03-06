import core from '@hcengineering/core'
import tracker, { type Project } from '@hcengineering/tracker'

import { linearError } from '../errors.js'
import { logger } from '../logger.js'
import { classifyHulyError, HulyApiError } from './classify-error.js'
import { getHulyClient } from './huly-client.js'

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
      linearError.validationFailed('fields', 'No update fields provided'),
    )
  }

  const client = await getHulyClient(userId)

  try {
    const project = (await client.findOne(tracker.class.Project, {
      _id: projectId as unknown as Parameters<typeof client.findOne>[1]['_id'],
    } as unknown as Parameters<typeof client.findOne>[1])) as unknown as Project | undefined

    if (!project) {
      throw new Error(`Project not found: ${projectId}`)
    }

    const updates: Record<string, unknown> = {}
    if (name !== undefined) {
      updates['name'] = name
    }
    if (description !== undefined) {
      updates['description'] = description
    }

    await client.updateDoc(
      tracker.class.Project,
      core.space.Space as unknown as Parameters<typeof client.updateDoc>[1],
      projectId as unknown as Parameters<typeof client.updateDoc>[2],
      updates,
    )

    log.info({ projectId, name: name ?? project.name }, 'Project updated')

    const hulyUrl = process.env['HULY_URL'] ?? ''
    const hulyWorkspace = process.env['HULY_WORKSPACE'] ?? ''

    return {
      id: projectId,
      name: name ?? project.name,
      identifier: project.identifier,
      url: `${hulyUrl}/workbench/${hulyWorkspace}/tracker/${project.identifier}`,
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
