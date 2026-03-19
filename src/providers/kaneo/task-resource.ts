import { z } from 'zod'

import { logger } from '../../logger.js'
import { classifyKaneoError } from './classify-error.js'
import { type KaneoConfig, kaneoFetch } from './client.js'
import { parseRelationsFromDescription, type TaskRelation } from './frontmatter.js'
import { type KaneoTaskListItem } from './list-tasks.js'
import { TaskSchema as KaneoTaskResponseSchema } from './schemas/create-task.js'
import { type TaskResult, KaneoSearchResponseSchema, TaskResultSchema } from './search-tasks.js'
import { addArchiveLabel, getOrCreateArchiveLabel, isTaskArchived } from './task-archive.js'
import { GetTasksResponseSchema } from './task-list-schema.js'
import { denormalizeStatus, validateStatus } from './task-status.js'
import { performUpdate } from './task-update-helpers.js'

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
  }): Promise<z.infer<typeof KaneoTaskResponseSchema>> {
    this.log.debug({ projectId: params.projectId, title: params.title }, 'Creating task')

    try {
      const status = await validateStatus(this.config, params.projectId, params.status ?? 'to-do')
      const task = await kaneoFetch(
        this.config,
        'POST',
        `/task/${params.projectId}`,
        {
          title: params.title,
          description: params.description ?? '',
          priority: params.priority ?? 'no-priority',
          status,
          dueDate: params.dueDate,
          userId: params.userId,
        },
        undefined,
        KaneoTaskResponseSchema,
      )
      // Denormalize status from column ID to slug
      task.status = await denormalizeStatus(this.config, params.projectId, task.status)
      this.log.info({ taskId: task.id, number: task.number }, 'Task created')
      return task
    } catch (error) {
      this.log.error({ error: error instanceof Error ? error.message : String(error) }, 'Failed to create task')
      throw classifyKaneoError(error)
    }
  }

  async list(projectId: string): Promise<KaneoTaskListItem[]> {
    this.log.debug({ projectId }, 'Listing tasks')

    try {
      const result = await kaneoFetch(
        this.config,
        'GET',
        `/task/tasks/${projectId}`,
        undefined,
        undefined,
        GetTasksResponseSchema,
      )
      const rawTasks = result.columns.flatMap((col) => col.tasks).concat(result.plannedTasks)
      const tasks: KaneoTaskListItem[] = rawTasks.map((task) => ({
        id: task.id,
        title: task.title,
        number: task.number,
        status: task.status,
        priority: task.priority,
        dueDate: task.dueDate ?? null,
      }))
      // Denormalize status from column slug to normalized slug for each task
      for (const task of tasks) {
        const column = result.columns.find((c) => c.id === task.status)
        if (column !== undefined) {
          task.status = column.name.toLowerCase().replace(/\s+/g, '-')
        }
      }
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
      // Denormalize status from column ID to slug
      task.status = await denormalizeStatus(this.config, task.projectId, task.status)
      const { relations } = parseRelationsFromDescription(task.description ?? '')
      this.log.info({ taskId, number: task.number, relationCount: relations.length }, 'Task fetched')
      // Return raw description (with frontmatter) for tests to check relation markers
      return {
        ...task,
        number: task.number ?? 0,
        description: task.description ?? '',
        relations,
        createdAt: typeof task.createdAt === 'string' ? task.createdAt : '',
        dueDate:
          task.dueDate === null || task.dueDate === undefined
            ? null
            : typeof task.dueDate === 'string'
              ? task.dueDate
              : JSON.stringify(task.dueDate),
      }
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
      userId?: string
    },
  ): Promise<z.infer<typeof KaneoTaskResponseSchema>> {
    this.log.debug({ taskId, ...params }, 'Updating task')

    try {
      // Validate and normalize status if being updated
      if (params.status !== undefined) {
        const existingTask = await this.get(taskId)
        params.status = await validateStatus(this.config, existingTask.projectId, params.status)
      }
      const task = await performUpdate(this.config, taskId, params)
      this.log.info({ taskId, number: task.number }, 'Task updated')
      return task
    } catch (error) {
      this.log.error({ error: error instanceof Error ? error.message : String(error) }, 'Failed to update task')
      throw classifyKaneoError(error)
    }
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
    limit?: number
  }): Promise<TaskResult[]> {
    this.log.debug(params, 'Searching tasks')
    try {
      const queryParams: Record<string, string> = {
        q: params.query,
        type: 'tasks',
        workspaceId: params.workspaceId,
        ...(params.projectId === undefined ? {} : { projectId: params.projectId }),
        ...(params.limit === undefined ? {} : { limit: String(params.limit) }),
      }
      const result = await kaneoFetch(this.config, 'GET', '/search', undefined, queryParams, KaneoSearchResponseSchema)
      // API returns a flat results array — filter to tasks only and remap taskNumber → number.
      // See: https://github.com/usekaneo/kaneo/blob/main/apps/api/src/search/controllers/global-search.ts
      const tasks: TaskResult[] = result.results
        .filter((r) => r.type === 'task')
        .map((r) => {
          const priorityParsed = TaskResultSchema.shape.priority.safeParse(r.priority)
          return {
            id: r.id,
            title: r.title,
            number: r.taskNumber ?? 0,
            status: r.status ?? '',
            priority: priorityParsed.success ? priorityParsed.data : 'no-priority',
            projectId: r.projectId ?? '',
          }
        })
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
      if (!alreadyArchived) {
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
    return (await import('./task-relations.js')).addTaskRelation(this.config, taskId, relatedTaskId, type)
  }
  async removeRelation(
    taskId: string,
    relatedTaskId: string,
  ): Promise<{ taskId: string; relatedTaskId: string; success: true }> {
    return (await import('./task-relations.js')).removeTaskRelation(this.config, taskId, relatedTaskId)
  }
  async updateRelation(
    taskId: string,
    relatedTaskId: string,
    type: TaskRelation['type'],
  ): Promise<{ taskId: string; relatedTaskId: string; type: string }> {
    return (await import('./task-relations.js')).updateTaskRelation(this.config, taskId, relatedTaskId, type)
  }
}
