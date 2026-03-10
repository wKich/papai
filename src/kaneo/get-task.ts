import { logger } from '../logger.js'
import { classifyKaneoError } from './classify-error.js'
import { type KaneoConfig, kaneoFetch } from './client.js'
import { type TaskRelation, parseRelationsFromDescription } from './frontmatter.js'

const log = logger.child({ scope: 'kaneo:get-task' })

interface KaneoTaskResponse {
  id: string
  title: string
  description: string
  number: number
  status: string
  priority: string
  dueDate: string | null
  createdAt: string
  projectId: string
  userId: string | null
}

export interface TaskDetails {
  id: string
  title: string
  description: string
  number: number
  status: string
  priority: string
  dueDate: string | null
  createdAt: string
  projectId: string
  userId: string | null
  relations: TaskRelation[]
}

export async function getTask({ config, taskId }: { config: KaneoConfig; taskId: string }): Promise<TaskDetails> {
  log.debug({ taskId }, 'getTask called')

  try {
    const task = await kaneoFetch<KaneoTaskResponse>(config, 'GET', `/task/${taskId}`)
    const { relations, body } = parseRelationsFromDescription(task.description)
    log.info({ taskId, number: task.number, relationCount: relations.length }, 'Task fetched')
    return {
      ...task,
      description: body,
      relations,
    }
  } catch (error) {
    log.error({ error: error instanceof Error ? error.message : String(error), taskId }, 'getTask failed')
    throw classifyKaneoError(error)
  }
}
