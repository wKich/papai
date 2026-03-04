import { LinearClient } from '@linear/sdk'

import { logger } from '../logger.js'
import { classifyLinearError } from './classify-error.js'

const log = logger.child({ scope: 'linear:create-label' })

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
  log.debug({ teamId, name, hasColor: color !== undefined }, 'createLabel called')

  try {
    const client = new LinearClient({ apiKey })
    const payload = await client.createIssueLabel({ teamId, name, color })
    const label = await payload.issueLabel
    if (!label) {
      throw new Error('No label returned')
    }
    log.info({ teamId, labelId: label.id, name }, 'Label created')
    return { id: label.id, name: label.name, color: label.color }
  } catch (error) {
    log.error({ error: error instanceof Error ? error.message : String(error), teamId, name }, 'createLabel failed')
    throw classifyLinearError(error)
  }
}
