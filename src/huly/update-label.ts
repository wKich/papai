/* oxlint-disable @typescript-eslint/no-unsafe-type-assertion */
import core from '@hcengineering/core'
import tags, { type TagElement } from '@hcengineering/tags'

import { hulyError } from '../errors.js'
import { logger } from '../logger.js'
import { classifyHulyError, HulyApiError } from './classify-error.js'
import { getHulyClient } from './huly-client.js'

const log = logger.child({ scope: 'huly:update-label' })

export interface UpdateLabelParams {
  userId: number
  labelId: string
  name?: string
  color?: string
}

export interface LabelResult {
  id: string
  name: string
  color: string
}

export async function updateLabel({ userId, labelId, name, color }: UpdateLabelParams): Promise<LabelResult> {
  log.debug({ userId, labelId, hasName: name !== undefined, hasColor: color !== undefined }, 'updateLabel called')

  // Validate that at least one field is provided
  if (name === undefined && color === undefined) {
    throw new HulyApiError(
      'At least one field (name or color) must be provided to update a label',
      hulyError.validationFailed('fields', 'No update fields provided'),
    )
  }

  const client = await getHulyClient(userId)

  try {
    // Check if label exists
    const existingLabel = (await client.findOne(tags.class.TagElement, {
      _id: labelId as unknown as Parameters<typeof client.findOne>[1]['_id'],
    } as unknown as Parameters<typeof client.findOne>[1])) as unknown as TagElement | undefined

    if (!existingLabel) {
      throw new Error(`Label not found: ${labelId}`)
    }

    // Build updates object
    const updates: Record<string, unknown> = {}
    if (name !== undefined) {
      updates['title'] = name
    }
    if (color !== undefined) {
      updates['color'] = color
    }

    // Update the label
    await client.updateDoc(
      tags.class.TagElement,
      core.space.Workspace as unknown as Parameters<typeof client.updateDoc>[1],
      labelId as unknown as Parameters<typeof client.updateDoc>[2],
      updates as unknown as Parameters<typeof client.updateDoc>[3],
    )

    // Fetch the updated label
    const label = (await client.findOne(tags.class.TagElement, {
      _id: labelId as unknown as Parameters<typeof client.findOne>[1]['_id'],
    } as unknown as Parameters<typeof client.findOne>[1])) as unknown as TagElement | undefined

    if (!label) {
      throw new Error(`Label not found after update: ${labelId}`)
    }

    log.info({ userId, labelId, name: label.title }, 'Label updated')

    return {
      id: label._id as string,
      name: label.title,
      color: label.color !== undefined ? numberToHexColor(label.color) : '#000000',
    }
  } catch (error) {
    log.error({ error: error instanceof Error ? error.message : String(error), userId, labelId }, 'updateLabel failed')
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
