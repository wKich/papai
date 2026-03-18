import type { AppError } from '../../errors.js'
import { addComment } from '../../kaneo/add-comment.js'
import { addTaskLabel } from '../../kaneo/add-task-label.js'
import { addTaskRelation } from '../../kaneo/add-task-relation.js'
import { archiveTask } from '../../kaneo/archive-task.js'
import { classifyKaneoError } from '../../kaneo/classify-error.js'
import { type KaneoConfig } from '../../kaneo/client.js'
import { createColumn } from '../../kaneo/create-column.js'
import { createLabel } from '../../kaneo/create-label.js'
import { createProject } from '../../kaneo/create-project.js'
import { createTask } from '../../kaneo/create-task.js'
import { deleteColumn } from '../../kaneo/delete-column.js'
import { deleteProject } from '../../kaneo/delete-project.js'
import { deleteTask } from '../../kaneo/delete-task.js'
import { getComments } from '../../kaneo/get-comments.js'
import { getTask } from '../../kaneo/get-task.js'
import { listColumns } from '../../kaneo/list-columns.js'
import { listLabels } from '../../kaneo/list-labels.js'
import { listProjects } from '../../kaneo/list-projects.js'
import { listTasks } from '../../kaneo/list-tasks.js'
import { removeComment } from '../../kaneo/remove-comment.js'
import { removeLabel } from '../../kaneo/remove-label.js'
import { removeTaskLabel } from '../../kaneo/remove-task-label.js'
import { removeTaskRelation } from '../../kaneo/remove-task-relation.js'
import { reorderColumns } from '../../kaneo/reorder-columns.js'
import { searchTasks } from '../../kaneo/search-tasks.js'
import { updateColumn } from '../../kaneo/update-column.js'
import { updateComment } from '../../kaneo/update-comment.js'
import { updateLabel } from '../../kaneo/update-label.js'
import { updateProject } from '../../kaneo/update-project.js'
import { updateTaskRelation } from '../../kaneo/update-task-relation.js'
import { updateTask } from '../../kaneo/update-task.js'
import { buildProjectUrl, buildTaskUrl } from '../../kaneo/url-builder.js'
import { logger } from '../../logger.js'
import type {
  Capability,
  Column,
  Comment,
  Label,
  Project,
  ProviderConfigRequirement,
  Task,
  TaskListItem,
  TaskProvider,
  TaskSearchResult,
  RelationType,
} from '../types.js'
import {
  mapColumn,
  mapComment,
  mapCreateTaskResponse,
  mapLabel,
  mapProject,
  mapTaskDetails,
  mapTaskListItem,
  mapTaskSearchResult,
} from './mappers.js'

const log = logger.child({ scope: 'provider:kaneo' })

const ALL_CAPABILITIES: ReadonlySet<Capability> = new Set<Capability>([
  'tasks.archive',
  'tasks.delete',
  'tasks.relations',
  'projects.crud',
  'comments.crud',
  'labels.crud',
  'columns.crud',
])

const CONFIG_REQUIREMENTS: readonly ProviderConfigRequirement[] = [
  { key: 'kaneo_apikey', label: 'Kaneo API Key', required: true },
]

/** KaneoProvider wraps existing src/kaneo/ functions to implement TaskProvider. */
export class KaneoProvider implements TaskProvider {
  readonly name = 'kaneo'
  readonly capabilities = ALL_CAPABILITIES
  readonly configRequirements = CONFIG_REQUIREMENTS

  constructor(
    private readonly config: KaneoConfig,
    private readonly workspaceId: string,
  ) {
    log.debug({ workspaceId }, 'KaneoProvider created')
  }

  async createTask(params: {
    projectId: string
    title: string
    description?: string
    priority?: string
    status?: string
    dueDate?: string
    assignee?: string
  }): Promise<Task> {
    const { projectId, title, description, priority, status, dueDate, assignee } = params
    const result = await createTask({
      config: this.config,
      projectId,
      title,
      description,
      priority,
      status,
      dueDate,
      userId: assignee,
    })
    return mapCreateTaskResponse(result, this.buildTaskUrl(result.id, result.projectId))
  }
  async getTask(taskId: string): Promise<Task> {
    const result = await getTask({ config: this.config, taskId })
    return mapTaskDetails(result, this.buildTaskUrl(result.id, result.projectId))
  }
  async updateTask(
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
      config: this.config,
      taskId,
      title,
      description,
      status,
      priority,
      dueDate,
      projectId,
      userId: assignee,
    })
    return mapCreateTaskResponse(result, this.buildTaskUrl(result.id, result.projectId))
  }
  async listTasks(projectId: string): Promise<TaskListItem[]> {
    const results = await listTasks({ config: this.config, projectId })
    return results.map((t) => mapTaskListItem(t))
  }
  async searchTasks(params: { query: string; projectId?: string; limit?: number }): Promise<TaskSearchResult[]> {
    const results = await searchTasks({
      config: this.config,
      query: params.query,
      workspaceId: this.workspaceId,
      projectId: params.projectId,
      limit: params.limit,
    })
    return results.map((t) => mapTaskSearchResult(t))
  }
  async archiveTask(taskId: string): Promise<{ id: string }> {
    const result = await archiveTask({ config: this.config, taskId, workspaceId: this.workspaceId })
    return { id: result.id }
  }
  async deleteTask(taskId: string): Promise<{ id: string }> {
    const result = await deleteTask({ config: this.config, taskId })
    return { id: result.id }
  }
  async listProjects(): Promise<Project[]> {
    const results = await listProjects({ config: this.config, workspaceId: this.workspaceId })
    return results.map((p) => mapProject(p, this.buildProjectUrl(p.id)))
  }
  async createProject(params: { name: string; description?: string }): Promise<Project> {
    const result = await createProject({
      config: this.config,
      workspaceId: this.workspaceId,
      name: params.name,
      description: params.description,
    })
    return mapProject(result, this.buildProjectUrl(result.id))
  }
  async updateProject(projectId: string, params: { name?: string; description?: string }): Promise<Project> {
    const result = await updateProject({
      config: this.config,
      workspaceId: this.workspaceId,
      projectId,
      name: params.name,
      description: params.description,
    })
    return mapProject(result, this.buildProjectUrl(result.id))
  }
  async archiveProject(projectId: string): Promise<{ id: string }> {
    const result = await deleteProject({ config: this.config, projectId })
    return { id: result.id }
  }
  async addComment(taskId: string, body: string): Promise<Comment> {
    const result = await addComment({ config: this.config, taskId, comment: body })
    return mapComment(result)
  }
  async getComments(taskId: string): Promise<Comment[]> {
    const results = await getComments({ config: this.config, taskId })
    return results.map(mapComment)
  }
  async updateComment(params: { taskId: string; commentId: string; body: string }): Promise<Comment> {
    const result = await updateComment({
      config: this.config,
      taskId: params.taskId,
      activityId: params.commentId,
      comment: params.body,
    })
    return mapComment(result)
  }
  async removeComment(commentId: string): Promise<{ id: string }> {
    const result = await removeComment({ config: this.config, activityId: commentId })
    return { id: result.id }
  }
  async listLabels(): Promise<Label[]> {
    const results = await listLabels({ config: this.config, workspaceId: this.workspaceId })
    return results.map(mapLabel)
  }
  async createLabel(params: { name: string; color?: string }): Promise<Label> {
    const result = await createLabel({
      config: this.config,
      workspaceId: this.workspaceId,
      name: params.name,
      color: params.color,
    })
    return mapLabel(result)
  }
  async updateLabel(labelId: string, params: { name?: string; color?: string }): Promise<Label> {
    const result = await updateLabel({ config: this.config, labelId, name: params.name, color: params.color })
    return mapLabel(result)
  }
  async removeLabel(labelId: string): Promise<{ id: string }> {
    const result = await removeLabel({ config: this.config, labelId })
    return { id: result.id }
  }
  addTaskLabel(taskId: string, labelId: string): Promise<{ taskId: string; labelId: string }> {
    return addTaskLabel({ config: this.config, taskId, labelId, workspaceId: this.workspaceId })
  }
  async removeTaskLabel(taskId: string, labelId: string): Promise<{ taskId: string; labelId: string }> {
    const result = await removeTaskLabel({ config: this.config, taskId, labelId })
    return { taskId: result.taskId, labelId: result.labelId }
  }
  addRelation(
    taskId: string,
    relatedTaskId: string,
    type: RelationType,
  ): Promise<{ taskId: string; relatedTaskId: string; type: string }> {
    return addTaskRelation({ config: this.config, taskId, relatedTaskId, type })
  }
  updateRelation(
    taskId: string,
    relatedTaskId: string,
    type: RelationType,
  ): Promise<{ taskId: string; relatedTaskId: string; type: string }> {
    return updateTaskRelation({ config: this.config, taskId, relatedTaskId, type })
  }
  async removeRelation(taskId: string, relatedTaskId: string): Promise<{ taskId: string; relatedTaskId: string }> {
    const result = await removeTaskRelation({ config: this.config, taskId, relatedTaskId })
    return { taskId: result.taskId, relatedTaskId: result.relatedTaskId }
  }
  async listColumns(projectId: string): Promise<Column[]> {
    const results = await listColumns({ config: this.config, projectId })
    return results.map(mapColumn)
  }
  async createColumn(
    projectId: string,
    params: { name: string; icon?: string; color?: string; isFinal?: boolean },
  ): Promise<Column> {
    const result = await createColumn({ config: this.config, projectId, ...params })
    return mapColumn(result)
  }
  async updateColumn(
    columnId: string,
    params: { name?: string; icon?: string; color?: string; isFinal?: boolean },
  ): Promise<Column> {
    const result = await updateColumn({ config: this.config, columnId, ...params })
    return mapColumn(result)
  }
  async deleteColumn(columnId: string): Promise<{ id: string }> {
    const result = await deleteColumn({ config: this.config, columnId })
    return { id: result.id }
  }
  async reorderColumns(projectId: string, columns: { id: string; position: number }[]): Promise<void> {
    await reorderColumns({ config: this.config, projectId, columns })
  }
  buildTaskUrl(taskId: string, projectId?: string): string {
    return buildTaskUrl(this.config.baseUrl, this.workspaceId, projectId ?? '', taskId)
  }
  buildProjectUrl(projectId: string): string {
    return buildProjectUrl(this.config.baseUrl, this.workspaceId, projectId)
  }
  classifyError(error: unknown): AppError {
    return classifyKaneoError(error).appError
  }
  getPromptAddendum(): string {
    return `IMPORTANT — Task status vs kanban columns:
- Columns define the board layout ("Todo", "In Progress", "Done"); task status is the column the task currently sits in.
- To move a task, update its status to the target column name. To change the board structure, use the column management tools.
- Always call list_columns before updating a task status to make sure the column exists.`
  }
}

/** Re-export KaneoConfig so the registry imports from the provider layer. */
export type { KaneoConfig }
