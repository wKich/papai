import { z } from 'zod'

import { logger } from '../logger.js'
import { classifyKaneoError } from './classify-error.js'
import { type KaneoConfig, KaneoLabelSchema, kaneoFetch } from './client.js'

const log = logger.child({ scope: 'kaneo:archive-task' })

const ARCHIVE_LABEL_NAME = 'archived'
const ARCHIVE_LABEL_COLOR = '#808080'

const KaneoLabelWithTaskSchema = KaneoLabelSchema.extend({
  taskId: z.string().optional(),
})

export type KaneoLabel = z.infer<typeof KaneoLabelSchema>

async function findOrCreateArchiveLabel(config: KaneoConfig, workspaceId: string): Promise<KaneoLabel> {
  const labels = await kaneoFetch(
    config,
    'GET',
    `/label/workspace/${workspaceId}`,
    undefined,
    undefined,
    z.array(KaneoLabelSchema),
  )
  const existing = labels.find((l) => l.name.toLowerCase() === ARCHIVE_LABEL_NAME)
  if (existing !== undefined) {
    return existing
  }

  log.info({ workspaceId }, 'Creating archive label')
  return kaneoFetch(
    config,
    'POST',
    '/label',
    {
      name: ARCHIVE_LABEL_NAME,
      color: ARCHIVE_LABEL_COLOR,
      workspaceId,
    },
    undefined,
    KaneoLabelSchema,
  )
}

function getTaskLabels(config: KaneoConfig, taskId: string): Promise<KaneoLabel[]> {
  return kaneoFetch(config, 'GET', `/label/task/${taskId}`, undefined, undefined, z.array(KaneoLabelSchema))
}

export async function archiveTask({
  config,
  taskId,
  workspaceId,
}: {
  config: KaneoConfig
  taskId: string
  workspaceId: string
}): Promise<{ id: string; archivedAt: string }> {
  log.debug({ taskId, workspaceId }, 'archiveTask called')

  try {
    const archiveLabel = await findOrCreateArchiveLabel(config, workspaceId)

    // Check if task already has the archive label
    const taskLabels = await getTaskLabels(config, taskId)
    const alreadyArchived = taskLabels.some((l) => l.id === archiveLabel.id)
    if (!alreadyArchived) {
      await kaneoFetch(
        config,
        'POST',
        '/label',
        {
          name: ARCHIVE_LABEL_NAME,
          color: ARCHIVE_LABEL_COLOR,
          workspaceId,
          taskId,
        },
        undefined,
        KaneoLabelWithTaskSchema,
      )
    }

    log.info({ taskId, labelId: archiveLabel.id }, 'Task archived via label')
    return { id: taskId, archivedAt: new Date().toISOString() }
  } catch (error) {
    log.error({ error: error instanceof Error ? error.message : String(error), taskId }, 'archiveTask failed')
    throw classifyKaneoError(error)
  }
}
