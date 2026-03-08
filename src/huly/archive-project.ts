import type { Ref, Space } from '@hcengineering/core'
import core from '@hcengineering/core'
import tracker, { type Project } from '@hcengineering/tracker'

import { logger } from '../logger.js'
import { getHulyClient } from './huly-client.js'
import { ensureRef } from './refs.js'
import { fetchProject } from './utils/fetchers.js'
import { withClient } from './utils/with-client.js'

const log = logger.child({ scope: 'huly:archive-project' })

export interface ArchiveProjectParams {
  userId: number
  projectId: string
}

export interface ArchiveProjectResult {
  id: string
  success: true
}

export function archiveProject({ userId, projectId }: ArchiveProjectParams): Promise<ArchiveProjectResult> {
  log.debug({ userId, projectId }, 'archiveProject called')

  return withClient(
    userId,
    getHulyClient,
    async (client) => {
      await fetchProject(client, projectId)
      ensureRef<Project>(projectId)

      await client.removeDoc(tracker.class.Project, core.space.Space as Ref<Space>, projectId)

      log.info({ projectId }, 'Project archived')

      return {
        id: projectId,
        success: true,
      }
    },
    { operation: 'archiveProject', projectId },
  )
}
