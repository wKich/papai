import { LinearClient } from '@linear/sdk'

import { logger } from '../logger.js'
import { classifyHulyError } from './classify-error.js'

const log = logger.child({ scope: 'linear:remove-label' })

export async function removeLabel({
  apiKey,
  labelId,
}: {
  apiKey: string
  labelId: string
}): Promise<{ id: string; success: true }> {
  log.debug({ labelId }, 'removeLabel called')

  try {
    const client = new LinearClient({ apiKey })
    await client.deleteIssueLabel(labelId)
    log.info({ labelId }, 'Label removed')
    return { id: labelId, success: true }
  } catch (error) {
    log.error({ error: error instanceof Error ? error.message : String(error), labelId }, 'removeLabel failed')
    throw classifyHulyError(error)
  }
}
