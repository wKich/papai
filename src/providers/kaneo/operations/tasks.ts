import type { ListTasksParams, Task, TaskListItem, TaskSearchResult } from '../../types.js'
import type { KaneoConfig } from '../client.js'
import { createTask } from '../create-task.js'
import { deleteTask } from '../delete-task.js'
import { getTask } from '../get-task.js'
import { listTasks } from '../list-tasks.js'
import { mapCreateTaskResponse, mapTaskDetails, mapTaskListItem, mapTaskSearchResult } from '../mappers.js'
import { searchTasks } from '../search-tasks.js'
import { updateTask } from '../update-task.js'
import { buildTaskUrl } from '../url-builder.js'

export async function kaneoCreateTask(
  config: KaneoConfig,
  workspaceId: string,
  params: {
    projectId: string
    title: string
    description?: string
    priority?: string
    status?: string
    dueDate?: string
    assignee?: string
  },
): Promise<Task> {
  const { projectId, title, description, priority, status, dueDate, assignee } = params
  const result = await createTask({
    config,
    projectId,
    title,
    description,
    priority,
    status,
    dueDate,
    userId: assignee,
  })
  return mapCreateTaskResponse(result, buildTaskUrl(config.baseUrl, workspaceId, result.projectId, result.id))
}

export async function kaneoGetTask(config: KaneoConfig, workspaceId: string, taskId: string): Promise<Task> {
  const result = await getTask({ config, taskId })
  return mapTaskDetails(result, buildTaskUrl(config.baseUrl, workspaceId, result.projectId, result.id))
}

export async function kaneoUpdateTask(
  config: KaneoConfig,
  workspaceId: string,
  taskId: string,
  params: {
    title?: string
    description?: string
    status?: string
    priority?: string
    dueDate?: string
    projectId?: string
    assignee?: string
  },
): Promise<Task> {
  const { title, description, status, priority, dueDate, projectId, assignee } = params
  const result = await updateTask({
    config,
    taskId,
    title,
    description,
    status,
    priority,
    dueDate,
    projectId,
    userId: assignee,
  })
  return mapCreateTaskResponse(result, buildTaskUrl(config.baseUrl, workspaceId, result.projectId, result.id))
}

export async function kaneoListTasks(
  config: KaneoConfig,
  workspaceId: string,
  projectId: string,
  params?: ListTasksParams,
): Promise<TaskListItem[]> {
  const results = await listTasks({ config, projectId, params })
  return results.map((t) => mapTaskListItem(t, buildTaskUrl(config.baseUrl, workspaceId, projectId, t.id)))
}

export async function kaneoSearchTasks(
  config: KaneoConfig,
  workspaceId: string,
  params: { query: string; projectId?: string; limit?: number },
): Promise<TaskSearchResult[]> {
  const results = await searchTasks({
    config,
    query: params.query,
    workspaceId,
    projectId: params.projectId,
    limit: params.limit,
  })
  return results.map((t) => mapTaskSearchResult(t, buildTaskUrl(config.baseUrl, workspaceId, t.projectId ?? '', t.id)))
}

export async function kaneoDeleteTask(config: KaneoConfig, taskId: string): Promise<{ id: string }> {
  const result = await deleteTask({ config, taskId })
  return { id: result.id }
}
