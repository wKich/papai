import { LinearClient } from '@linear/sdk'

import { logger } from '../logger.js'
import { classifyLinearError } from './classify-error.js'
import { filterPresentNodes } from './response-guards.js'

const log = logger.child({ scope: 'linear:list-projects' })

export async function listProjects({
  apiKey,
}: {
  apiKey: string
}): Promise<{ teamId: string; teamName: string; projects: { id: string; name: string }[] }[]> {
  log.debug('listProjects called')

  try {
    const client = new LinearClient({ apiKey })
    const teams = await client.teams()
    const result = await Promise.all(
      filterPresentNodes(teams.nodes, { entityName: 'team', parentId: 'teams' }).map(async (team) => {
        if (typeof team.id !== 'string' || typeof team.name !== 'string') {
          log.warn({ teamId: team.id }, 'Skipping team with invalid response shape')
          return undefined
        }
        const projects = await team.projects()
        const validProjects = filterPresentNodes(projects.nodes, { entityName: 'project', parentId: team.id }).flatMap(
          (p) => {
            if (typeof p.id !== 'string' || typeof p.name !== 'string') {
              log.warn({ teamId: team.id, projectId: p.id }, 'Skipping project with invalid response shape')
              return []
            }
            return [{ id: p.id, name: p.name }]
          },
        )
        return {
          teamId: team.id,
          teamName: team.name,
          projects: validProjects,
        }
      }),
    )
    const mappedResult = result.flatMap((team) => (team ? [team] : []))
    log.info(
      { teamCount: mappedResult.length, totalProjects: mappedResult.reduce((sum, t) => sum + t.projects.length, 0) },
      'Projects listed',
    )
    return mappedResult
  } catch (error) {
    log.error({ error: error instanceof Error ? error.message : String(error) }, 'listProjects failed')
    throw classifyLinearError(error)
  }
}
