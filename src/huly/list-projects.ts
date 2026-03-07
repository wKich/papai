import tracker, { type Project } from '@hcengineering/tracker'

import { logger } from '../logger.js'
import { classifyHulyError } from './classify-error.js'
import { getHulyClient } from './huly-client.js'

const log = logger.child({ scope: 'huly:list-projects' })

interface ProjectData {
  id: string
  name: string
  identifier: string
  description: string | undefined
}

export async function listProjects({
  userId,
}: {
  userId: number
}): Promise<{ teamId: string; teamName: string; projects: ProjectData[] }[]> {
  log.debug({ userId }, 'listProjects called')

  const client = await getHulyClient(userId)

  try {
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
  } catch (error) {
    log.error({ error: error instanceof Error ? error.message : String(error), userId }, 'listProjects failed')
    throw classifyHulyError(error)
  } finally {
    await client.close()
  }
}
