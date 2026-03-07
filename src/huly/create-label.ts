/* oxlint-disable @typescript-eslint/no-unsafe-type-assertion */
import core, { generateId } from '@hcengineering/core'
import tags, { type TagElement } from '@hcengineering/tags'
import tracker from '@hcengineering/tracker'

import { logger } from '../logger.js'
import { classifyHulyError } from './classify-error.js'
import { getHulyClient } from './huly-client.js'

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

export async function createLabel({ userId, name, color }: CreateLabelParams): Promise<LabelResult> {
  log.debug({ userId, name, color: color !== undefined }, 'createLabel called')

  const client = await getHulyClient(userId)

  try {
    const labelId = generateId()

    // Create the label in workspace space
    await client.createDoc(
      tags.class.TagElement,
      core.space.Workspace as unknown as Parameters<typeof client.createDoc>[1],
      {
        title: name,
        color: color ?? '#000000',
        targetClass: tracker.class.Issue,
      } as unknown as Parameters<typeof client.createDoc>[2],
      labelId,
    )

    // Fetch the created label
    const label = (await client.findOne(tags.class.TagElement, {
      _id: labelId as unknown as Parameters<typeof client.findOne>[1]['_id'],
    } as unknown as Parameters<typeof client.findOne>[1])) as unknown as TagElement | undefined

    if (!label) {
      throw new Error('Label was not created')
    }

    log.info({ userId, labelId, name }, 'Label created')

    return {
      id: label._id as string,
      name: label.title,
      color: label.color !== undefined ? numberToHexColor(label.color) : '#000000',
    }
  } catch (error) {
    log.error({ error: error instanceof Error ? error.message : String(error), userId, name }, 'createLabel failed')
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
