import core, { generateId } from '@hcengineering/core'
import tags, { type TagElement } from '@hcengineering/tags'
import tracker from '@hcengineering/tracker'

import { logger } from '../logger.js'
import { getHulyClient } from './huly-client.js'
import { hexColorToNumber, numberToHexColor } from './utils/color.js'
import { withClient } from './utils/with-client.js'

const log = logger.child({ scope: 'huly:create-label' })

export interface CreateLabelParams {
  userId: number
  name: string
  color?: string
}

export interface LabelResult {
  id: string
  name: string
  color: string
}

export function createLabel({ userId, name, color }: CreateLabelParams): Promise<LabelResult> {
  log.debug({ userId, name, color: color !== undefined }, 'createLabel called')

  return withClient(userId, getHulyClient, async (client) => {
    const labelId = generateId<TagElement>()

    await client.createDoc(
      tags.class.TagElement,
      core.space.Workspace,
      {
        title: name,
        color: hexColorToNumber(color),
        description: '',
        category: tags.category.NoCategory,
        targetClass: tracker.class.Issue,
      },
      labelId,
    )

    const label = await client.findOne<TagElement>(tags.class.TagElement, { _id: labelId })

    if (label === undefined) {
      throw new Error('Label was not created')
    }

    log.info({ userId, labelId, name }, 'Label created')

    return {
      id: label._id,
      name: label.title,
      color: numberToHexColor(label.color),
    }
  })
}
