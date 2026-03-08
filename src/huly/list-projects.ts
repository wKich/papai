import tracker, { type Project } from '@hcengineering/tracker'

import { logger } from '../logger.js'
import { getHulyClient } from './huly-client.js'
import { withClient } from './utils/with-client.js'

const log = logger.child({ scope: 'huly:list-projects' })

interface ProjectData {
  id: string
  name: string
  identifier: string
  description: string | undefined
}

export function listProjects({
  userId,
}: {
  userId: number
}): Promise<{ teamId: string; teamName: string; projects: ProjectData[] }[]> {
  log.debug({ userId }, 'listProjects called')

  return withClient(
    userId,
    getHulyClient,
    async (client) => {
      const projects = await client.findAll<Project>(tracker.class.Project, {})

      const mappedProjects: ProjectData[] = projects.map((project) => ({
        id: project._id as string,
        name: project.name,
        identifier: project.identifier,
        description: project.description === undefined ? undefined : String(project.description),
      }))

      log.info({ projectCount: mappedProjects.length }, 'Projects listed')

      return [
        {
          teamId: 'default',
          teamName: 'Projects',
          projects: mappedProjects,
        },
      ]
    },
    { operation: 'listProjects' },
  )
}
