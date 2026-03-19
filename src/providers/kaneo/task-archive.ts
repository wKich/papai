import { z } from 'zod'

import { logger } from '../../logger.js'
import { type KaneoConfig, kaneoFetch } from './client.js'
import { LabelResource } from './label-resource.js'
import { CreateLabelResponseSchema } from './schemas/create-label.js'

const ARCHIVE_LABEL_NAME = 'archived'
const ARCHIVE_LABEL_COLOR = '#808080'

const log = logger.child({ scope: 'kaneo:task-archive' })

export async function getOrCreateArchiveLabel(
  config: KaneoConfig,
  workspaceId: string,
): Promise<z.infer<typeof CreateLabelResponseSchema>> {
  log.debug({ workspaceId }, 'Getting or creating archive label')

  const labels = await kaneoFetch(
    config,
    'GET',
    `/label/workspace/${workspaceId}`,
    undefined,
    undefined,
    z.array(CreateLabelResponseSchema),
  )
  const existing = labels.find((l) => l.name.toLowerCase() === ARCHIVE_LABEL_NAME)
  if (existing !== undefined) {
    log.debug({ labelId: existing.id }, 'Found existing archive label')
    return existing
  }

  log.debug({ workspaceId }, 'Creating new archive label')
  const labelResource = new LabelResource(config)
  const created = await labelResource.create({
    workspaceId,
    name: ARCHIVE_LABEL_NAME,
    color: ARCHIVE_LABEL_COLOR,
  })
  log.info({ labelId: created.id }, 'Created archive label')
  return created
}

export async function isTaskArchived(config: KaneoConfig, taskId: string, archiveLabelId: string): Promise<boolean> {
  log.debug({ taskId, archiveLabelId }, 'Checking if task is archived')

  const labels = await kaneoFetch(
    config,
    'GET',
    `/label/task/${taskId}`,
    undefined,
    undefined,
    z.array(CreateLabelResponseSchema),
  )
  const isArchived = labels.some((l) => l.id === archiveLabelId)
  log.debug({ taskId, isArchived }, 'Task archive status checked')
  return isArchived
}

export async function addArchiveLabel(config: KaneoConfig, workspaceId: string, taskId: string): Promise<void> {
  log.debug({ taskId, workspaceId }, 'Adding archive label to task')

  const labelResource = new LabelResource(config)
  const archiveLabel = await getOrCreateArchiveLabel(config, workspaceId)
  await labelResource.addToTask(taskId, archiveLabel.id, workspaceId)

  log.info({ taskId, labelId: archiveLabel.id }, 'Archive label added to task')
}
