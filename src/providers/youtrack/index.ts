import type { AppError } from '../../errors.js'
import { logger } from '../../logger.js'
import type { Comment, Label, Project, Task, TaskListItem, TaskProvider, TaskSearchResult } from '../types.js'
import { classifyYouTrackError } from './classify-error.js'
import { type YouTrackConfig } from './client.js'
import { CONFIG_REQUIREMENTS, YOUTRACK_CAPABILITIES } from './constants.js'
import {
  addYouTrackTaskLabel,
  createYouTrackLabel,
  listYouTrackLabels,
  removeYouTrackLabel,
  removeYouTrackTaskLabel,
  updateYouTrackLabel,
} from './labels.js'
import {
  addYouTrackComment,
  getYouTrackComments,
  removeYouTrackComment,
  updateYouTrackComment,
} from './operations/comments.js'
import {
  archiveYouTrackProject,
  createYouTrackProject,
  getYouTrackProject,
  listYouTrackProjects,
  updateYouTrackProject,
} from './operations/projects.js'
import {
  createYouTrackTask,
  deleteYouTrackTask,
  getYouTrackTask,
  listYouTrackTasks,
  searchYouTrackTasks,
  updateYouTrackTask,
} from './operations/tasks.js'
import { addYouTrackRelation, removeYouTrackRelation, updateYouTrackRelation } from './relations.js'

const log = logger.child({ scope: 'provider:youtrack' })

export class YouTrackProvider implements TaskProvider {
  readonly name = 'youtrack'
  readonly capabilities = YOUTRACK_CAPABILITIES
  readonly configRequirements = CONFIG_REQUIREMENTS

  constructor(private readonly config: YouTrackConfig) {
    log.debug('YouTrackProvider created')
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
    return createYouTrackTask(this.config, params)
  }

  getTask(taskId: string): Promise<Task> {
    return getYouTrackTask(this.config, taskId)
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
    return updateYouTrackTask(this.config, taskId, params)
  }

  listTasks(projectId: string): Promise<TaskListItem[]> {
    return listYouTrackTasks(this.config, projectId)
  }

  searchTasks(params: { query: string; projectId?: string; limit?: number }): Promise<TaskSearchResult[]> {
    return searchYouTrackTasks(this.config, params)
  }

  deleteTask(taskId: string): Promise<{ id: string }> {
    return deleteYouTrackTask(this.config, taskId)
  }

  getProject(projectId: string): Promise<Project> {
    return getYouTrackProject(this.config, projectId)
  }

  listProjects(): Promise<Project[]> {
    return listYouTrackProjects(this.config)
  }

  createProject(params: { name: string; description?: string }): Promise<Project> {
    return createYouTrackProject(this.config, params)
  }

  updateProject(projectId: string, params: { name?: string; description?: string }): Promise<Project> {
    return updateYouTrackProject(this.config, projectId, params)
  }

  archiveProject(projectId: string): Promise<{ id: string }> {
    return archiveYouTrackProject(this.config, projectId)
  }

  addComment(taskId: string, body: string): Promise<Comment> {
    return addYouTrackComment(this.config, taskId, body)
  }

  getComments(taskId: string): Promise<Comment[]> {
    return getYouTrackComments(this.config, taskId)
  }

  updateComment(params: { taskId: string; commentId: string; body: string }): Promise<Comment> {
    return updateYouTrackComment(this.config, params)
  }

  removeComment(params: { taskId: string; commentId: string }): Promise<{ id: string }> {
    return removeYouTrackComment(this.config, params)
  }

  listLabels(): Promise<Label[]> {
    return listYouTrackLabels(this.config)
  }

  createLabel(params: { name: string; color?: string }): Promise<Label> {
    return createYouTrackLabel(this.config, params)
  }

  updateLabel(labelId: string, params: { name?: string; color?: string }): Promise<Label> {
    return updateYouTrackLabel(this.config, labelId, params)
  }

  removeLabel(labelId: string): Promise<{ id: string }> {
    return removeYouTrackLabel(this.config, labelId)
  }

  addTaskLabel(taskId: string, labelId: string): Promise<{ taskId: string; labelId: string }> {
    return addYouTrackTaskLabel(this.config, taskId, labelId)
  }

  removeTaskLabel(taskId: string, labelId: string): Promise<{ taskId: string; labelId: string }> {
    return removeYouTrackTaskLabel(this.config, taskId, labelId)
  }

  addRelation(
    taskId: string,
    relatedTaskId: string,
    type: import('../types.js').RelationType,
  ): Promise<{ taskId: string; relatedTaskId: string; type: string }> {
    return addYouTrackRelation(this.config, taskId, relatedTaskId, type)
  }

  removeRelation(taskId: string, relatedTaskId: string): Promise<{ taskId: string; relatedTaskId: string }> {
    return removeYouTrackRelation(this.config, taskId, relatedTaskId)
  }

  updateRelation(
    taskId: string,
    relatedTaskId: string,
    type: import('../types.js').RelationType,
  ): Promise<{ taskId: string; relatedTaskId: string; type: string }> {
    return updateYouTrackRelation(this.config, taskId, relatedTaskId, type)
  }

  buildTaskUrl(taskId: string): string {
    return `${this.config.baseUrl}/issue/${taskId}`
  }

  buildProjectUrl(projectId: string): string {
    return `${this.config.baseUrl}/projects/${projectId}`
  }

  classifyError(error: unknown): AppError {
    return classifyYouTrackError(error)
  }

  getPromptAddendum(): string {
    return [
      'IMPORTANT — YouTrack issue statuses:',
      '- Issues use "State" as a custom field (e.g. "Open", "In Progress", "Fixed", "Verified").',
      '- State transitions may be governed by workflows. If a state update fails, try a different valid state.',
      '- Issue IDs are human-readable like "PROJ-123". Always use these readable IDs.',
      '- Tags are used as labels. To add/remove tags, use the label tools.',
    ].join('\n')
  }
}
