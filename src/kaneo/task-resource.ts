import { z } from 'zod'

import { logger } from '../logger.js'
import { classifyKaneoError } from './classify-error.js'
import { type KaneoConfig, KaneoTaskSchema, KaneoTaskResponseSchema, kaneoFetch } from './client.js'
import { parseRelationsFromDescription, type TaskRelation } from './frontmatter.js'
import { addArchiveLabel, getOrCreateArchiveLabel, isTaskArchived } from './task-archive.js'

const KaneoTaskListItemSchema = KaneoTaskSchema.extend({
  dueDate: z.string().nullable(),
})

const FullTaskSchema = KaneoTaskResponseSchema.extend({
  position: z.number(),
})

const TaskResultSchema = z.object({
  id: z.string(),
  title: z.string(),
  number: z.number(),
  status: z.string(),
  priority: z.string(),
})

const TaskSearchResultSchema = z.object({
  tasks: z.array(TaskResultSchema),
})

export { addTaskRelation, removeTaskRelation, updateTaskRelation } from './task-relations.js'

export class TaskResource {
  private log = logger.child({ scope: 'kaneo:task-resource' })

  constructor(private config: KaneoConfig) {}

  async create(params: {
    projectId: string
    title: string
    description?: string
    priority?: string
    status?: string
    dueDate?: string
    userId?: string
  }): Promise<z.infer<typeof KaneoTaskSchema>> {
    this.log.debug({ projectId: params.projectId, title: params.title }, 'Creating task')

    try {
      const task = await kaneoFetch(
        this.config,
        'POST',
        `/task/${params.projectId}`,
        {
          title: params.title,
          description: params.description ?? '',
          priority: params.priority ?? 'no-priority',
          status: params.status ?? 'todo',
          dueDate: params.dueDate,
          userId: params.userId,
        },
        undefined,
        KaneoTaskSchema,
      )
      this.log.info({ taskId: task.id, number: task.number }, 'Task created')
      return task
    } catch (error) {
      this.log.error({ error: error instanceof Error ? error.message : String(error) }, 'Failed to create task')
      throw classifyKaneoError(error)
    }
  }

  async list(projectId: string): Promise<z.infer<typeof KaneoTaskListItemSchema>[]> {
    this.log.debug({ projectId }, 'Listing tasks')

    try {
      const tasks = await kaneoFetch(
        this.config,
        'GET',
        `/task/tasks/${projectId}`,
        undefined,
        undefined,
        z.array(KaneoTaskListItemSchema),
      )
      this.log.info({ count: tasks.length }, 'Tasks listed')
      return tasks
    } catch (error) {
      this.log.error({ error: error instanceof Error ? error.message : String(error) }, 'Failed to list tasks')
      throw classifyKaneoError(error)
    }
  }

  async get(taskId: string): Promise<{
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
  }> {
    this.log.debug({ taskId }, 'Getting task')

    try {
      const task = await kaneoFetch(
        this.config,
        'GET',
        `/task/${taskId}`,
        undefined,
        undefined,
        KaneoTaskResponseSchema,
      )
      const { relations, body } = parseRelationsFromDescription(task.description)
      this.log.info({ taskId, number: task.number, relationCount: relations.length }, 'Task fetched')
      return { ...task, description: body, relations }
    } catch (error) {
      this.log.error({ error: error instanceof Error ? error.message : String(error) }, 'Failed to get task')
      throw classifyKaneoError(error)
    }
  }

  async update(
    taskId: string,
    params: {
      title?: string
      description?: string
      status?: string
      priority?: string
      dueDate?: string
      projectId?: string
      userId?: string
    },
  ): Promise<z.infer<typeof KaneoTaskSchema>> {
    this.log.debug({ taskId, ...params }, 'Updating task')

    try {
      const task = await this.performUpdate(taskId, params)
      this.log.info({ taskId, number: task.number }, 'Task updated')
      return task
    } catch (error) {
      this.log.error({ error: error instanceof Error ? error.message : String(error) }, 'Failed to update task')
      throw classifyKaneoError(error)
    }
  }

  private singleFieldUpdate(taskId: string, field: string, value: unknown): Promise<z.infer<typeof KaneoTaskSchema>> {
    const endpoints: Record<string, { path: string; key: string }> = {
      status: { path: '/task/status/', key: 'status' },
      priority: { path: '/task/priority/', key: 'priority' },
      userId: { path: '/task/assignee/', key: 'userId' },
      dueDate: { path: '/task/due-date/', key: 'dueDate' },
      title: { path: '/task/title/', key: 'title' },
      description: { path: '/task/description/', key: 'description' },
    }
    const endpoint = endpoints[field]
    if (endpoint === undefined) throw new Error(`Unknown field: ${field}`)
    return kaneoFetch(
      this.config,
      'PUT',
      `${endpoint.path}${taskId}`,
      { [endpoint.key]: value },
      undefined,
      KaneoTaskSchema,
    )
  }

  private async fullUpdate(
    taskId: string,
    params: {
      title?: string
      description?: string
      status?: string
      priority?: string
      dueDate?: string
      projectId?: string
      userId?: string
    },
  ): Promise<z.infer<typeof KaneoTaskSchema>> {
    const current = await kaneoFetch(this.config, 'GET', `/task/${taskId}`, undefined, undefined, FullTaskSchema)
    return kaneoFetch(
      this.config,
      'PUT',
      `/task/${taskId}`,
      {
        title: params.title ?? current.title,
        description: params.description ?? current.description,
        status: params.status ?? current.status,
        priority: params.priority ?? current.priority,
        dueDate: params.dueDate ?? current.dueDate,
        projectId: params.projectId ?? current.projectId,
        position: current.position,
        userId: params.userId,
      },
      undefined,
      KaneoTaskSchema,
    )
  }

  private performUpdate(
    taskId: string,
    params: {
      title?: string
      description?: string
      status?: string
      priority?: string
      dueDate?: string
      projectId?: string
      userId?: string
    },
  ): Promise<z.infer<typeof KaneoTaskSchema>> {
    const setFields = Object.entries(params).filter(([, v]) => v !== undefined)
    if (setFields.length === 1) {
      return this.singleFieldUpdate(taskId, setFields[0]![0], setFields[0]![1])
    }
    return this.fullUpdate(taskId, params)
  }

  async delete(taskId: string): Promise<{ id: string; success: true }> {
    this.log.debug({ taskId }, 'Deleting task')

    try {
      await kaneoFetch(this.config, 'DELETE', `/task/${taskId}`, undefined, undefined, z.unknown())
      this.log.info({ taskId }, 'Task deleted')
      return { id: taskId, success: true }
    } catch (error) {
      this.log.error({ error: error instanceof Error ? error.message : String(error) }, 'Failed to delete task')
      throw classifyKaneoError(error)
    }
  }

  async search(params: {
    query: string
    workspaceId: string
    projectId?: string
  }): Promise<z.infer<typeof TaskResultSchema>[]> {
    this.log.debug(params, 'Searching tasks')

    try {
      const queryParams: Record<string, string> = {
        q: params.query,
        type: 'tasks',
        workspaceId: params.workspaceId,
      }
      if (params.projectId !== undefined) {
        queryParams['projectId'] = params.projectId
      }

      const result = await kaneoFetch(this.config, 'GET', '/search', undefined, queryParams, TaskSearchResultSchema)
      const tasks = result.tasks ?? []
      this.log.info({ count: tasks.length }, 'Tasks searched')
      return tasks
    } catch (error) {
      this.log.error({ error: error instanceof Error ? error.message : String(error) }, 'Failed to search tasks')
      throw classifyKaneoError(error)
    }
  }

  async archive(taskId: string, workspaceId: string): Promise<{ id: string; archivedAt: string }> {
    this.log.debug({ taskId, workspaceId }, 'Archiving task')
    try {
      const archiveLabel = await getOrCreateArchiveLabel(this.config, workspaceId)
      const alreadyArchived = await isTaskArchived(this.config, taskId, archiveLabel.id)
      if (alreadyArchived) {
        this.log.debug({ taskId }, 'Task already has archive label, skipping')
      } else {
        await addArchiveLabel(this.config, workspaceId, taskId)
      }
      this.log.info({ taskId, labelId: archiveLabel.id }, 'Task archived')
      return { id: taskId, archivedAt: new Date().toISOString() }
    } catch (error) {
      this.log.error({ error: error instanceof Error ? error.message : String(error) }, 'Failed to archive task')
      throw classifyKaneoError(error)
    }
  }
  async addRelation(
    taskId: string,
    relatedTaskId: string,
    type: TaskRelation['type'],
  ): Promise<{ taskId: string; relatedTaskId: string; type: string }> {
    const { addTaskRelation } = await import('./task-relations.js')
    return addTaskRelation(this.config, taskId, relatedTaskId, type)
  }
  async removeRelation(
    taskId: string,
    relatedTaskId: string,
  ): Promise<{ taskId: string; relatedTaskId: string; success: true }> {
    const { removeTaskRelation } = await import('./task-relations.js')
    return removeTaskRelation(this.config, taskId, relatedTaskId)
  }
  async updateRelation(
    taskId: string,
    relatedTaskId: string,
    type: TaskRelation['type'],
  ): Promise<{ taskId: string; relatedTaskId: string; type: string }> {
    const { updateTaskRelation } = await import('./task-relations.js')
    return updateTaskRelation(this.config, taskId, relatedTaskId, type)
  }
}
