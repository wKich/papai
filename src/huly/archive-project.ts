import type { Ref, Space } from '@hcengineering/core'
import core from '@hcengineering/core'
import tracker, { type Project } from '@hcengineering/tracker'

import { logger } from '../logger.js'
import { classifyHulyError } from './classify-error.js'
import { getHulyClient } from './huly-client.js'
import { ensureRef } from './refs.js'

const log = logger.child({ scope: 'huly:archive-project' })

export interface ArchiveProjectParams {
  userId: number
  projectId: string
}

export interface ArchiveProjectResult {
  id: string
  success: true
}

export async function archiveProject({ userId, projectId }: ArchiveProjectParams): Promise<ArchiveProjectResult> {
  log.debug({ userId, projectId }, 'archiveProject called')

  const client = await getHulyClient(userId)

  ensureRef<Project>(projectId)

  try {
    const project = await client.findOne(tracker.class.Project, { _id: projectId })

    if (!project) {
      throw new Error(`Project not found: ${projectId}`)
    }

    await client.removeDoc(tracker.class.Project, core.space.Space as Ref<Space>, projectId)

    log.info({ projectId }, 'Project archived')

    return {
      id: projectId,
      success: true,
    }
  } catch (error) {
    log.error(
      { error: error instanceof Error ? error.message : String(error), userId, projectId },
      'archiveProject failed',
    )
    throw classifyHulyError(error)
  } finally {
    await client.close()
  }
}
