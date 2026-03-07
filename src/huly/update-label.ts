import core, { type Ref, type DocumentUpdate } from '@hcengineering/core'
import tags, { type TagElement } from '@hcengineering/tags'

import { hulyError } from '../errors.js'
import { logger } from '../logger.js'
import { classifyHulyError, HulyApiError } from './classify-error.js'
import { getHulyClient } from './huly-client.js'
import { ensureRef } from './refs.js'
import type { HulyClient } from './types.js'
import { hexColorToNumber, numberToHexColor } from './utils/color.js'

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

function buildUpdateFields(name: string | undefined, color: string | undefined): DocumentUpdate<TagElement> {
  const updates: DocumentUpdate<TagElement> = {}
  if (name !== undefined) {
    updates.title = name
  }
  if (color !== undefined) {
    updates.color = hexColorToNumber(color)
  }
  return updates
}

async function findLabel(client: HulyClient, labelId: Ref<TagElement>): Promise<TagElement> {
  const label = await client.findOne<TagElement>(tags.class.TagElement, { _id: labelId })

  if (label === undefined) {
    throw new Error(`Label not found: ${labelId}`)
  }

  return label
}

async function updateLabelDoc(
  client: HulyClient,
  labelId: Ref<TagElement>,
  updates: DocumentUpdate<TagElement>,
): Promise<void> {
  await client.updateDoc(tags.class.TagElement, core.space.Workspace, labelId, updates)
}

export async function updateLabel({ userId, labelId, name, color }: UpdateLabelParams): Promise<LabelResult> {
  log.debug({ userId, labelId, hasName: name !== undefined, hasColor: color !== undefined }, 'updateLabel called')

  if (name === undefined && color === undefined) {
    throw new HulyApiError(
      'At least one field (name or color) must be provided to update a label',
      hulyError.validationFailed('fields', 'No update fields provided'),
    )
  }

  ensureRef<TagElement>(labelId)
  const client = await getHulyClient(userId)

  try {
    await findLabel(client, labelId)
    const updates = buildUpdateFields(name, color)
    await updateLabelDoc(client, labelId, updates)
    const updatedLabel = await findLabel(client, labelId)

    log.info({ userId, labelId, name: updatedLabel.title }, 'Label updated')

    return {
      id: updatedLabel._id,
      name: updatedLabel.title,
      color: numberToHexColor(updatedLabel.color),
    }
  } catch (error) {
    log.error({ error: error instanceof Error ? error.message : String(error), userId, labelId }, 'updateLabel failed')
    throw classifyHulyError(error)
  } finally {
    await client.close()
  }
}
