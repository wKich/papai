import core from '@hcengineering/core'
import tracker, { type Project } from '@hcengineering/tracker'

import { logger } from '../logger.js'
import { classifyHulyError } from './classify-error.js'
import { getHulyClient } from './huly-client.js'

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

  try {
    const project = (await client.findOne(tracker.class.Project, {
      _id: projectId as unknown as Parameters<typeof client.findOne>[1]['_id'],
    } as unknown as Parameters<typeof client.findOne>[1])) as unknown as Project | undefined

    if (!project) {
      throw new Error(`Project not found: ${projectId}`)
    }

    await client.removeDoc(
      tracker.class.Project,
      core.space.Space as unknown as Parameters<typeof client.removeDoc>[1],
      projectId as unknown as Parameters<typeof client.removeDoc>[2],
    )

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
