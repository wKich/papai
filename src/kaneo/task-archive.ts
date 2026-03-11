import { z } from 'zod'

import { classifyKaneoError } from './classify-error.js'
import { type KaneoConfig, KaneoLabelSchema, kaneoFetch } from './client.js'

const KaneoLabelWithTaskSchema = KaneoLabelSchema.extend({
  taskId: z.string().optional(),
})

const ARCHIVE_LABEL_NAME = 'archived'
const ARCHIVE_LABEL_COLOR = '#808080'

export async function getOrCreateArchiveLabel(
  config: KaneoConfig,
  workspaceId: string,
): Promise<z.infer<typeof KaneoLabelSchema>> {
  const labels = await kaneoFetch(
    config,
    'GET',
    `/label/workspace/${workspaceId}`,
    undefined,
    undefined,
    z.array(KaneoLabelSchema),
  )
  const existing = labels.find((l) => l.name.toLowerCase() === ARCHIVE_LABEL_NAME)
  if (existing !== undefined) return existing

  return kaneoFetch(
    config,
    'POST',
    '/label',
    { name: ARCHIVE_LABEL_NAME, color: ARCHIVE_LABEL_COLOR, workspaceId },
    undefined,
    KaneoLabelSchema,
  )
}

export async function isTaskArchived(config: KaneoConfig, taskId: string, archiveLabelId: string): Promise<boolean> {
  const labels = await kaneoFetch(
    config,
    'GET',
    `/label/task/${taskId}`,
    undefined,
    undefined,
    z.array(KaneoLabelSchema),
  )
  return labels.some((l) => l.id === archiveLabelId)
}

export async function addArchiveLabel(config: KaneoConfig, workspaceId: string, taskId: string): Promise<void> {
  await kaneoFetch(
    config,
    'POST',
    '/label',
    { name: ARCHIVE_LABEL_NAME, color: ARCHIVE_LABEL_COLOR, workspaceId, taskId },
    undefined,
    KaneoLabelWithTaskSchema,
  )
}

export { classifyKaneoError, ARCHIVE_LABEL_NAME, ARCHIVE_LABEL_COLOR }
