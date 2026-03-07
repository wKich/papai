import core from '@hcengineering/core'
import tags, { type TagElement } from '@hcengineering/tags'

import { logger } from '../logger.js'
import { getHulyClient } from './huly-client.js'
import { ensureRef } from './refs.js'
import { fetchLabel } from './utils/fetchers.js'
import { withClient } from './utils/with-client.js'

const log = logger.child({ scope: 'huly:remove-label' })

export interface RemoveLabelParams {
  userId: number
  labelId: string
}

export interface RemoveLabelResult {
  id: string
  success: true
}

export function removeLabel({ userId, labelId }: RemoveLabelParams): Promise<RemoveLabelResult> {
  log.debug({ userId, labelId }, 'removeLabel called')

  return withClient(userId, getHulyClient, async (client) => {
    await fetchLabel(client, labelId)
    ensureRef<TagElement>(labelId)

    await client.removeDoc(tags.class.TagElement, core.space.Workspace, labelId)

    log.info({ userId, labelId }, 'Label removed')

    return { id: labelId, success: true }
  })
}
