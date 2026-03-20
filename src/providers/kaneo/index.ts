import type { AppError } from '../../errors.js'
import { logger } from '../../logger.js'
import type {
  Column,
  Comment,
  Label,
  Project,
  RelationType,
  Task,
  TaskListItem,
  TaskProvider,
  TaskSearchResult,
} from '../types.js'
import { classifyKaneoError } from './classify-error.js'
import { type KaneoConfig } from './client.js'
import { ALL_CAPABILITIES, CONFIG_REQUIREMENTS } from './constants.js'
import { kaneoAddComment, kaneoGetComments, kaneoRemoveComment, kaneoUpdateComment } from './operations/comments.js'
import {
  kaneoAddTaskLabel,
  kaneoCreateLabel,
  kaneoListLabels,
  kaneoRemoveLabel,
  kaneoRemoveTaskLabel,
  kaneoUpdateLabel,
} from './operations/labels.js'
import {
  kaneoArchiveProject,
  kaneoCreateProject,
  kaneoListProjects,
  kaneoUpdateProject,
} from './operations/projects.js'
import { kaneoAddRelation, kaneoRemoveRelation, kaneoUpdateRelation } from './operations/relations.js'
import {
  kaneoDeleteStatus,
  kaneoCreateStatus,
  kaneoListStatuses,
  kaneoReorderStatuses,
  kaneoUpdateStatus,
} from './operations/statuses.js'
import {
  kaneoArchiveTask,
  kaneoCreateTask,
  kaneoDeleteTask,
  kaneoGetTask,
  kaneoListTasks,
  kaneoSearchTasks,
  kaneoUpdateTask,
} from './operations/tasks.js'
import { buildProjectUrl, buildTaskUrl } from './url-builder.js'

const log = logger.child({ scope: 'provider:kaneo' })

/** KaneoProvider wraps kaneo operation functions to implement TaskProvider. */
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

  createTask(params: {
    projectId: string
    title: string
    description?: string
    priority?: string
    status?: string
    dueDate?: string
    assignee?: string
  }): Promise<Task> {
    return kaneoCreateTask(this.config, this.workspaceId, params)
  }

  getTask(taskId: string): Promise<Task> {
    return kaneoGetTask(this.config, this.workspaceId, taskId)
  }

  updateTask(
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
    return kaneoUpdateTask(this.config, this.workspaceId, taskId, params)
  }

  listTasks(projectId: string): Promise<TaskListItem[]> {
    return kaneoListTasks(this.config, this.workspaceId, projectId)
  }

  searchTasks(params: { query: string; projectId?: string; limit?: number }): Promise<TaskSearchResult[]> {
    return kaneoSearchTasks(this.config, this.workspaceId, params)
  }

  archiveTask(taskId: string): Promise<{ id: string }> {
    return kaneoArchiveTask(this.config, this.workspaceId, taskId)
  }

  deleteTask(taskId: string): Promise<{ id: string }> {
    return kaneoDeleteTask(this.config, taskId)
  }

  listProjects(): Promise<Project[]> {
    return kaneoListProjects(this.config, this.workspaceId)
  }

  createProject(params: { name: string; description?: string }): Promise<Project> {
    return kaneoCreateProject(this.config, this.workspaceId, params)
  }

  updateProject(projectId: string, params: { name?: string; description?: string }): Promise<Project> {
    return kaneoUpdateProject(this.config, this.workspaceId, projectId, params)
  }

  archiveProject(projectId: string): Promise<{ id: string }> {
    return kaneoArchiveProject(this.config, projectId)
  }

  addComment(taskId: string, body: string): Promise<Comment> {
    return kaneoAddComment(this.config, taskId, body)
  }

  getComments(taskId: string): Promise<Comment[]> {
    return kaneoGetComments(this.config, taskId)
  }

  updateComment(params: { taskId: string; commentId: string; body: string }): Promise<Comment> {
    return kaneoUpdateComment(this.config, params)
  }

  removeComment(params: { taskId: string; commentId: string }): Promise<{ id: string }> {
    return kaneoRemoveComment(this.config, params)
  }

  listLabels(): Promise<Label[]> {
    return kaneoListLabels(this.config, this.workspaceId)
  }

  createLabel(params: { name: string; color?: string }): Promise<Label> {
    return kaneoCreateLabel(this.config, this.workspaceId, params)
  }

  updateLabel(labelId: string, params: { name?: string; color?: string }): Promise<Label> {
    return kaneoUpdateLabel(this.config, labelId, params)
  }

  removeLabel(labelId: string): Promise<{ id: string }> {
    return kaneoRemoveLabel(this.config, labelId)
  }

  addTaskLabel(taskId: string, labelId: string): Promise<{ taskId: string; labelId: string }> {
    return kaneoAddTaskLabel(this.config, this.workspaceId, taskId, labelId)
  }

  removeTaskLabel(taskId: string, labelId: string): Promise<{ taskId: string; labelId: string }> {
    return kaneoRemoveTaskLabel(this.config, taskId, labelId)
  }

  addRelation(
    taskId: string,
    relatedTaskId: string,
    type: RelationType,
  ): Promise<{ taskId: string; relatedTaskId: string; type: string }> {
    return kaneoAddRelation(this.config, taskId, relatedTaskId, type)
  }

  updateRelation(
    taskId: string,
    relatedTaskId: string,
    type: RelationType,
  ): Promise<{ taskId: string; relatedTaskId: string; type: string }> {
    return kaneoUpdateRelation(this.config, taskId, relatedTaskId, type)
  }

  removeRelation(taskId: string, relatedTaskId: string): Promise<{ taskId: string; relatedTaskId: string }> {
    return kaneoRemoveRelation(this.config, taskId, relatedTaskId)
  }

  listStatuses(projectId: string): Promise<Column[]> {
    return kaneoListStatuses(this.config, projectId)
  }

  createStatus(
    projectId: string,
    params: { name: string; icon?: string; color?: string; isFinal?: boolean },
  ): Promise<Column> {
    return kaneoCreateStatus(this.config, projectId, params)
  }

  updateStatus(
    statusId: string,
    params: { name?: string; icon?: string; color?: string; isFinal?: boolean },
  ): Promise<Column> {
    return kaneoUpdateStatus(this.config, statusId, params)
  }

  deleteStatus(statusId: string): Promise<{ id: string }> {
    return kaneoDeleteStatus(this.config, statusId)
  }

  reorderStatuses(projectId: string, statuses: { id: string; position: number }[]): Promise<void> {
    return kaneoReorderStatuses(this.config, projectId, statuses)
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
