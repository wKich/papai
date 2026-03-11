import { logger } from '../logger.js'
import { classifyKaneoError } from './classify-error.js'
import { type KaneoConfig } from './client.js'
import { KaneoClient } from './kaneo-client.js'

const log = logger.child({ scope: 'kaneo:archive-task' })

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
    const client = new KaneoClient(config)
    const result = await client.tasks.archive(taskId, workspaceId)
    log.info({ taskId }, 'Task archived')
    return result
  } catch (error) {
    log.error({ error: error instanceof Error ? error.message : String(error), taskId }, 'archiveTask failed')
    throw classifyKaneoError(error)
  }
}
