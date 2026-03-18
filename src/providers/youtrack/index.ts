import type { AppError } from '../../errors.js'
import { logger } from '../../logger.js'
import type { Comment, Label, Project, Task, TaskListItem, TaskProvider, TaskSearchResult } from '../types.js'
import { classifyYouTrackError } from './classify-error.js'
import { type YouTrackConfig, youtrackFetch } from './client.js'
import {
  COMMENT_FIELDS,
  CONFIG_REQUIREMENTS,
  ISSUE_FIELDS,
  ISSUE_LIST_FIELDS,
  PROJECT_FIELDS,
  YOUTRACK_CAPABILITIES,
} from './constants.js'
import {
  addYouTrackTaskLabel,
  createYouTrackLabel,
  listYouTrackLabels,
  removeYouTrackLabel,
  removeYouTrackTaskLabel,
  updateYouTrackLabel,
} from './labels.js'
import { buildCustomFields, mapComment, mapIssueToListItem, mapIssueToSearchResult, mapIssueToTask } from './mappers.js'
import { addYouTrackRelation, removeYouTrackRelation } from './relations.js'
import type { YtComment, YtIssue, YtProject } from './types.js'

const log = logger.child({ scope: 'provider:youtrack' })

export class YouTrackProvider implements TaskProvider {
  readonly name = 'youtrack'
  readonly capabilities = YOUTRACK_CAPABILITIES
  readonly configRequirements = CONFIG_REQUIREMENTS

  constructor(private readonly config: YouTrackConfig) {
    log.debug('YouTrackProvider created')
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
    log.debug({ projectId: params.projectId, title: params.title }, 'createTask')
    const body: Record<string, unknown> = {
      project: { id: params.projectId },
      summary: params.title,
    }
    if (params.description !== undefined) body['description'] = params.description

    const customFields = buildCustomFields(params)
    if (customFields.length > 0) body['customFields'] = customFields

    const issue = await youtrackFetch<YtIssue>(this.config, 'POST', '/api/issues', {
      body,
      query: { fields: ISSUE_FIELDS },
    })
    log.info({ issueId: issue.idReadable ?? issue.id }, 'Issue created')
    return mapIssueToTask(issue, this.config.baseUrl)
  }

  async getTask(taskId: string): Promise<Task> {
    log.debug({ taskId }, 'getTask')
    const issue = await youtrackFetch<YtIssue>(this.config, 'GET', `/api/issues/${taskId}`, {
      query: { fields: ISSUE_FIELDS },
    })
    return mapIssueToTask(issue, this.config.baseUrl)
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
    log.debug({ taskId, hasTitle: params.title !== undefined, hasStatus: params.status !== undefined }, 'updateTask')
    const body: Record<string, unknown> = {}
    if (params.title !== undefined) body['summary'] = params.title
    if (params.description !== undefined) body['description'] = params.description
    if (params.projectId !== undefined) body['project'] = { id: params.projectId }

    const customFields = buildCustomFields(params)
    if (customFields.length > 0) body['customFields'] = customFields

    const issue = await youtrackFetch<YtIssue>(this.config, 'POST', `/api/issues/${taskId}`, {
      body,
      query: { fields: ISSUE_FIELDS },
    })
    log.info({ issueId: issue.idReadable ?? issue.id }, 'Issue updated')
    return mapIssueToTask(issue, this.config.baseUrl)
  }

  async listTasks(projectId: string): Promise<TaskListItem[]> {
    log.debug({ projectId }, 'listTasks')
    const issues = await youtrackFetch<YtIssue[]>(this.config, 'GET', '/api/issues', {
      query: { fields: ISSUE_LIST_FIELDS, query: `project: {${projectId}}`, $top: '100' },
    })
    log.info({ projectId, count: issues.length }, 'Tasks listed')
    return issues.map(mapIssueToListItem)
  }

  async searchTasks(params: { query: string; projectId?: string; limit?: number }): Promise<TaskSearchResult[]> {
    log.debug({ query: params.query, projectId: params.projectId }, 'searchTasks')
    let query = params.query
    if (params.projectId !== undefined) {
      query = `project: {${params.projectId}} ${query}`
    }
    const issues = await youtrackFetch<YtIssue[]>(this.config, 'GET', '/api/issues', {
      query: { fields: ISSUE_LIST_FIELDS, query, $top: String(params.limit ?? 50) },
    })
    log.info({ query: params.query, count: issues.length }, 'Tasks searched')
    return issues.map(mapIssueToSearchResult)
  }

  async deleteTask(taskId: string): Promise<{ id: string }> {
    log.debug({ taskId }, 'deleteTask')
    await youtrackFetch(this.config, 'DELETE', `/api/issues/${taskId}`)
    log.info({ taskId }, 'Issue deleted')
    return { id: taskId }
  }

  async getProject(projectId: string): Promise<Project> {
    log.debug({ projectId }, 'getProject')
    const project = await youtrackFetch<YtProject>(this.config, 'GET', `/api/admin/projects/${projectId}`, {
      query: { fields: PROJECT_FIELDS },
    })
    log.info({ projectId: project.id, name: project.name }, 'Project retrieved')
    return {
      id: project.id,
      name: project.name,
      description: project.description,
      url: `${this.config.baseUrl}/projects/${project.shortName ?? project.id}`,
    }
  }

  async listProjects(): Promise<Project[]> {
    log.debug('listProjects')
    const projects = await youtrackFetch<YtProject[]>(this.config, 'GET', '/api/admin/projects', {
      query: { fields: PROJECT_FIELDS, $top: '100' },
    })
    log.info({ count: projects.length }, 'Projects listed')
    return projects
      .filter((p) => p.archived !== true)
      .map((p) => ({
        id: p.id,
        name: p.name,
        description: p.description,
        url: `${this.config.baseUrl}/projects/${p.shortName ?? p.id}`,
      }))
  }

  async createProject(params: { name: string; description?: string }): Promise<Project> {
    log.debug({ name: params.name }, 'createProject')
    // Generate shortName from name (first 10 chars, uppercase, no spaces)
    const shortName = params.name
      .toUpperCase()
      .replace(/[^A-Z0-9]/g, '')
      .slice(0, 10)
    const body: Record<string, unknown> = {
      name: params.name,
      shortName,
    }
    if (params.description !== undefined) body['description'] = params.description
    const project = await youtrackFetch<YtProject>(this.config, 'POST', '/api/admin/projects', {
      body,
      query: { fields: PROJECT_FIELDS },
    })
    log.info({ projectId: project.id, name: project.name }, 'Project created')
    return {
      id: project.id,
      name: project.name,
      description: project.description,
      url: `${this.config.baseUrl}/projects/${project.shortName ?? project.id}`,
    }
  }

  async updateProject(projectId: string, params: { name?: string; description?: string }): Promise<Project> {
    log.debug({ projectId, hasName: params.name !== undefined }, 'updateProject')
    const body: Record<string, unknown> = {}
    if (params.name !== undefined) body['name'] = params.name
    if (params.description !== undefined) body['description'] = params.description
    const project = await youtrackFetch<YtProject>(this.config, 'POST', `/api/admin/projects/${projectId}`, {
      body,
      query: { fields: PROJECT_FIELDS },
    })
    log.info({ projectId: project.id }, 'Project updated')
    return {
      id: project.id,
      name: project.name,
      description: project.description,
      url: `${this.config.baseUrl}/projects/${project.shortName ?? project.id}`,
    }
  }

  async archiveProject(projectId: string): Promise<{ id: string }> {
    log.debug({ projectId }, 'archiveProject')
    await youtrackFetch(this.config, 'POST', `/api/admin/projects/${projectId}`, {
      body: { archived: true },
      query: { fields: 'id' },
    })
    log.info({ projectId }, 'Project archived')
    return { id: projectId }
  }

  async addComment(taskId: string, body: string): Promise<Comment> {
    log.debug({ taskId }, 'addComment')
    const comment = await youtrackFetch<YtComment>(this.config, 'POST', `/api/issues/${taskId}/comments`, {
      body: { text: body },
      query: { fields: COMMENT_FIELDS },
    })
    log.info({ taskId, commentId: comment.id }, 'Comment added')
    return mapComment(comment)
  }

  async getComments(taskId: string): Promise<Comment[]> {
    log.debug({ taskId }, 'getComments')
    const comments = await youtrackFetch<YtComment[]>(this.config, 'GET', `/api/issues/${taskId}/comments`, {
      query: { fields: COMMENT_FIELDS, $top: '100' },
    })
    log.info({ taskId, count: comments.length }, 'Comments retrieved')
    return comments.map(mapComment)
  }

  async updateComment(params: { taskId: string; commentId: string; body: string }): Promise<Comment> {
    log.debug({ taskId: params.taskId, commentId: params.commentId }, 'updateComment')
    const comment = await youtrackFetch<YtComment>(
      this.config,
      'POST',
      `/api/issues/${params.taskId}/comments/${params.commentId}`,
      { body: { text: params.body }, query: { fields: COMMENT_FIELDS } },
    )
    log.info({ commentId: comment.id }, 'Comment updated')
    return mapComment(comment)
  }

  async removeComment(params: { taskId: string; commentId: string }): Promise<{ id: string }> {
    log.debug({ taskId: params.taskId, commentId: params.commentId }, 'removeComment')
    await youtrackFetch(this.config, 'DELETE', `/api/issues/${params.taskId}/comments/${params.commentId}`)
    log.info({ taskId: params.taskId, commentId: params.commentId }, 'Comment removed')
    return { id: params.commentId }
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

export type { YouTrackConfig }
