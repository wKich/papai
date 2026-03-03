import { LinearClient } from '@linear/sdk'

import { logger } from '../logger.js'
import { classifyLinearError } from './classify-error.js'

export async function listLabels({
  apiKey,
  teamId,
}: {
  apiKey: string
  teamId: string
}): Promise<{ id: string; name: string; color: string }[]> {
  logger.debug({ teamId }, 'listLabels called')

  try {
    const client = new LinearClient({ apiKey })
    const team = await client.team(teamId)
    const labels = await team.labels()
    const result = labels.nodes.map((l) => ({ id: l.id, name: l.name, color: l.color }))
    logger.info({ teamId, labelCount: result.length }, 'Labels listed')
    return result
  } catch (error) {
    logger.error({ error: error instanceof Error ? error.message : String(error), teamId }, 'listLabels failed')
    throw classifyLinearError(error)
  }
}
