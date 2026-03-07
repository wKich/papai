/* oxlint-disable @typescript-eslint/no-unsafe-type-assertion */
import core from '@hcengineering/core'
import tags, { type TagElement } from '@hcengineering/tags'

import { logger } from '../logger.js'
import { classifyHulyError } from './classify-error.js'
import { getHulyClient } from './huly-client.js'

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

  try {
    // Check if label exists
    const existingLabel = (await client.findOne(tags.class.TagElement, {
      _id: labelId as unknown as Parameters<typeof client.findOne>[1]['_id'],
    } as unknown as Parameters<typeof client.findOne>[1])) as unknown as TagElement | undefined

    if (!existingLabel) {
      throw new Error(`Label not found: ${labelId}`)
    }

    // Remove the label
    await client.removeDoc(
      tags.class.TagElement,
      core.space.Workspace as unknown as Parameters<typeof client.removeDoc>[1],
      labelId as unknown as Parameters<typeof client.removeDoc>[2],
    )

    log.info({ userId, labelId }, 'Label removed')

    return { id: labelId, success: true }
  } catch (error) {
    log.error({ error: error instanceof Error ? error.message : String(error), userId, labelId }, 'removeLabel failed')
    throw classifyHulyError(error)
  } finally {
    await client.close()
  }
}
