import { LinearClient } from '@linear/sdk'

import { logger } from '../logger.js'
import { classifyLinearError } from './classify-error.js'

export async function createLabel({
  apiKey,
  teamId,
  name,
  color,
}: {
  apiKey: string
  teamId: string
  name: string
  color?: string
}): Promise<{ id: string; name: string; color: string }> {
  logger.debug({ teamId, name, hasColor: color !== undefined }, 'createLabel called')

  try {
    const client = new LinearClient({ apiKey })
    const payload = await client.createIssueLabel({ teamId, name, color })
    const label = await payload.issueLabel
    if (!label) {
      throw new Error('No label returned')
    }
    logger.info({ teamId, labelId: label.id, name }, 'Label created')
    return { id: label.id, name: label.name, color: label.color }
  } catch (error) {
    logger.error({ error: error instanceof Error ? error.message : String(error), teamId, name }, 'createLabel failed')
    throw classifyLinearError(error)
  }
}
