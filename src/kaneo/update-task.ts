import { logger } from '../logger.js'
import { classifyKaneoError } from './classify-error.js'
import { type KaneoConfig, kaneoFetch } from './client.js'

const log = logger.child({ scope: 'kaneo:update-task' })

interface KaneoTask {
  id: string
  title: string
  number: number
  status: string
  priority: string
}

type UpdateParams = {
  title?: string
  description?: string
  status?: string
  priority?: string
  dueDate?: string
  projectId?: string
  userId?: string
}

type FieldEndpoint = { field: keyof UpdateParams; path: string; bodyKey: string }

const FIELD_ENDPOINTS: FieldEndpoint[] = [
  { field: 'status', path: '/task/status/', bodyKey: 'status' },
  { field: 'priority', path: '/task/priority/', bodyKey: 'priority' },
  { field: 'userId', path: '/task/assignee/', bodyKey: 'userId' },
  { field: 'dueDate', path: '/task/due-date/', bodyKey: 'dueDate' },
  { field: 'title', path: '/task/title/', bodyKey: 'title' },
  { field: 'description', path: '/task/description/', bodyKey: 'description' },
]

function trySingleFieldUpdate(
  config: KaneoConfig,
  taskId: string,
  params: UpdateParams,
): Promise<KaneoTask> | undefined {
  const setFields = Object.entries(params).filter(([, v]) => v !== undefined)
  if (setFields.length !== 1) return undefined
  const [fieldName, value] = setFields[0]!
  const endpoint = FIELD_ENDPOINTS.find((e) => e.field === fieldName)
  if (endpoint === undefined) return undefined
  return kaneoFetch<KaneoTask>(config, 'PUT', `${endpoint.path}${taskId}`, { [endpoint.bodyKey]: value })
}

async function fullUpdate(config: KaneoConfig, taskId: string, params: UpdateParams): Promise<KaneoTask> {
  type FullTask = KaneoTask & { description: string; dueDate: string | null; projectId: string; position: number }
  const current = await kaneoFetch<FullTask>(config, 'GET', `/task/${taskId}`)
  return kaneoFetch<KaneoTask>(config, 'PUT', `/task/${taskId}`, {
    title: params.title ?? current.title,
    description: params.description ?? current.description,
    status: params.status ?? current.status,
    priority: params.priority ?? current.priority,
    dueDate: params.dueDate ?? current.dueDate,
    projectId: params.projectId ?? current.projectId,
    position: current.position,
    userId: params.userId,
  })
}

export async function updateTask({
  config,
  taskId,
  ...params
}: UpdateParams & { config: KaneoConfig; taskId: string }): Promise<KaneoTask> {
  log.debug(
    { taskId, status: params.status, priority: params.priority, projectId: params.projectId },
    'updateTask called',
  )

  try {
    const task = await (trySingleFieldUpdate(config, taskId, params) ?? fullUpdate(config, taskId, params))
    log.info({ taskId, number: task.number }, 'Task updated')
    return task
  } catch (error) {
    log.error({ error: error instanceof Error ? error.message : String(error), taskId }, 'updateTask failed')
    throw classifyKaneoError(error)
  }
}
