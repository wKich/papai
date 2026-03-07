/* oxlint-disable @typescript-eslint/no-unsafe-type-assertion */
import tags, { type TagElement } from '@hcengineering/tags'
import tracker from '@hcengineering/tracker'

import { logger } from '../logger.js'
import { classifyHulyError } from './classify-error.js'
import { getHulyClient } from './huly-client.js'

const log = logger.child({ scope: 'huly:list-labels' })

interface LabelData {
  id: string
  name: string
  color: string
}

export async function listLabels({ userId }: { userId: number }): Promise<LabelData[]> {
  log.debug({ userId }, 'listLabels called')

  const client = await getHulyClient(userId)

  try {
    // Find all tag elements that target issues (labels)
    const labels = (await client.findAll(tags.class.TagElement, {
      targetClass: tracker.class.Issue,
    } as unknown as Parameters<typeof client.findAll>[1])) as unknown as TagElement[]

    const result: LabelData[] = labels.map((label) => ({
      id: label._id as string,
      name: label.title,
      color: label.color !== undefined ? numberToHexColor(label.color) : '#000000',
    }))

    log.info({ userId, labelCount: result.length }, 'Labels listed')
    return result
  } catch (error) {
    log.error({ error: error instanceof Error ? error.message : String(error), userId }, 'listLabels failed')
    throw classifyHulyError(error)
  } finally {
    await client.close()
  }
}

function numberToHexColor(color: unknown): string {
  if (typeof color === 'number') {
    return `#${color.toString(16).padStart(6, '0')}`
  }
  if (typeof color === 'string' && color.startsWith('#')) {
    return color
  }
  return '#000000'
}
