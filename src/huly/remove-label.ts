import core from '@hcengineering/core'
import tags, { type TagElement } from '@hcengineering/tags'

import { logger } from '../logger.js'
import { classifyHulyError } from './classify-error.js'
import { getHulyClient } from './huly-client.js'
import { ensureRef } from './refs.js'

const log = logger.child({ scope: 'huly:remove-label' })

export interface RemoveLabelParams {
  userId: number
  labelId: string
}

export interface RemoveLabelResult {
  id: string
  success: true
}

export async function removeLabel({ userId, labelId }: RemoveLabelParams): Promise<RemoveLabelResult> {
  log.debug({ userId, labelId }, 'removeLabel called')

  const client = await getHulyClient(userId)

  ensureRef<TagElement>(labelId)

  try {
    const existingLabel = await client.findOne<TagElement>(tags.class.TagElement, { _id: labelId })

    if (existingLabel === undefined) {
      throw new Error(`Label not found: ${labelId}`)
    }

    await client.removeDoc(tags.class.TagElement, core.space.Workspace, labelId)

    log.info({ userId, labelId }, 'Label removed')

    return { id: labelId, success: true }
  } catch (error) {
    log.error({ error: error instanceof Error ? error.message : String(error), userId, labelId }, 'removeLabel failed')
    throw classifyHulyError(error)
  } finally {
    await client.close()
  }
}
