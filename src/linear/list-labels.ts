import { LinearClient } from '@linear/sdk'

import { linearError } from '../errors.js'
import { logger } from '../logger.js'
import { classifyHulyError } from './classify-error.js'
import { filterPresentNodes, requireEntity } from './response-guards.js'

const log = logger.child({ scope: 'linear:list-labels' })

export async function listLabels({
  apiKey,
  teamId,
}: {
  apiKey: string
  teamId: string
}): Promise<{ id: string; name: string; color: string }[]> {
  log.debug({ teamId }, 'listLabels called')

  try {
    const client = new LinearClient({ apiKey })
    const team = requireEntity(await client.team(teamId), {
      entityName: 'team',
      context: { teamId },
      appError: linearError.teamNotFound(teamId),
    })
    const labels = await team.labels()
    const result = filterPresentNodes(labels.nodes, { entityName: 'label', parentId: teamId }).flatMap((l) => {
      if (typeof l.id !== 'string' || typeof l.name !== 'string' || typeof l.color !== 'string') {
        log.warn({ teamId, labelId: l.id }, 'Skipping label with invalid response shape')
        return []
      }
      return [{ id: l.id, name: l.name, color: l.color }]
    })
    log.info({ teamId, labelCount: result.length }, 'Labels listed')
    return result
  } catch (error) {
    log.error({ error: error instanceof Error ? error.message : String(error), teamId }, 'listLabels failed')
    throw classifyHulyError(error)
  }
}
