import { LinearClient } from '@linear/sdk'

import { linearError } from '../errors.js'
import { logger } from '../logger.js'
import { classifyLinearError, LinearApiError } from './classify-error.js'
import { requireEntity } from './response-guards.js'

const log = logger.child({ scope: 'linear:update-label' })

export async function updateLabel({
  apiKey,
  labelId,
  name,
  description,
  color,
}: {
  apiKey: string
  labelId: string
  name?: string
  description?: string
  color?: string
}): Promise<{ id: string; name: string; color: string }> {
  log.debug(
    { labelId, hasName: name !== undefined, hasDescription: description !== undefined, hasColor: color !== undefined },
    'updateLabel called',
  )

  // Validate that at least one field is provided
  if (name === undefined && description === undefined && color === undefined) {
    throw new LinearApiError(
      'At least one field (name, description, or color) must be provided to update a label',
      linearError.validationFailed('fields', 'No update fields provided'),
    )
  }

  try {
    const client = new LinearClient({ apiKey })
    const payload = await client.updateIssueLabel(labelId, {
      name,
      description,
      color,
    })
    const label = requireEntity(await payload.issueLabel, {
      entityName: 'label',
      context: { labelId },
      appError: linearError.labelNotFound(labelId),
    })
    log.info({ labelId, name: label.name }, 'Label updated')
    return { id: label.id, name: label.name, color: label.color }
  } catch (error) {
    log.error({ error: error instanceof Error ? error.message : String(error), labelId }, 'updateLabel failed')
    throw classifyLinearError(error)
  }
}
