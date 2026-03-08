import tags, { type TagElement } from '@hcengineering/tags'
import tracker from '@hcengineering/tracker'

import { logger } from '../logger.js'
import { getHulyClient } from './huly-client.js'
import { numberToHexColor } from './utils/color.js'
import { withClient } from './utils/with-client.js'

const log = logger.child({ scope: 'huly:list-labels' })

interface LabelData {
  id: string
  name: string
  color: string
}

export function listLabels({ userId }: { userId: number }): Promise<LabelData[]> {
  log.debug({ userId }, 'listLabels called')

  return withClient(
    userId,
    getHulyClient,
    async (client) => {
      const labels = await client.findAll<TagElement>(tags.class.TagElement, {
        targetClass: tracker.class.Issue,
      })

      const result: LabelData[] = labels.map((label) => ({
        id: label._id as string,
        name: label.title,
        color: label.color === undefined ? '#000000' : numberToHexColor(label.color),
      }))

      log.info({ userId, labelCount: result.length }, 'Labels listed')
      return result
    },
    { operation: 'listLabels' },
  )
}
