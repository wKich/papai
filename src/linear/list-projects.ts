import { LinearClient } from '@linear/sdk'

import { logger } from '../logger.js'
import { classifyLinearError } from './classify-error.js'

export async function listProjects({
  apiKey,
}: {
  apiKey: string
}): Promise<{ teamId: string; teamName: string; projects: { id: string; name: string }[] }[]> {
  logger.debug('listProjects called')

  try {
    const client = new LinearClient({ apiKey })
    const teams = await client.teams()
    const result = await Promise.all(
      teams.nodes.map(async (team) => {
        const projects = await team.projects()
        return {
          teamId: team.id,
          teamName: team.name,
          projects: projects.nodes.map((p) => ({ id: p.id, name: p.name })),
        }
      }),
    )
    logger.info(
      { teamCount: result.length, totalProjects: result.reduce((sum, t) => sum + t.projects.length, 0) },
      'Projects listed',
    )
    return result
  } catch (error) {
    logger.error({ error: error instanceof Error ? error.message : String(error) }, 'listProjects failed')
    throw classifyLinearError(error)
  }
}
