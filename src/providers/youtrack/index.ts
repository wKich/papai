import type { AppError } from '../../errors.js'
import { providerError } from '../../errors.js'
import { logger } from '../../logger.js'
import { ProviderClassifiedError } from '../errors.js'
import type {
  Comment,
  Label,
  Project,
  RelationType,
  Task,
  TaskListItem,
  TaskProvider,
  TaskSearchResult,
} from '../types.js'
import { classifyYouTrackError } from './classify-error.js'
import { type YouTrackConfig, youtrackFetch } from './client.js'
import { buildLinkCommand, buildRemoveLinkCommand } from './commands.js'
import {
  COMMENT_FIELDS,
  CONFIG_REQUIREMENTS,
  ISSUE_FIELDS,
  ISSUE_LIST_FIELDS,
  PROJECT_FIELDS,
  TAG_FIELDS,
  YOUTRACK_CAPABILITIES,
} from './constants.js'
import { buildCustomFields, mapComment, mapIssueToListItem, mapIssueToSearchResult, mapIssueToTask } from './mappers.js'
import type { YtComment, YtIssue, YtProject, YtTag } from './types.js'

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

  removeComment(_commentId: string): Promise<{ id: string }> {
    const err = providerError.unsupportedOperation('removeComment without taskId')
    throw new ProviderClassifiedError(err.operation, err)
  }

  async listLabels(): Promise<Label[]> {
    log.debug('listLabels')
    const tags = await youtrackFetch<YtTag[]>(this.config, 'GET', '/api/tags', {
      query: { fields: TAG_FIELDS, $top: '100' },
    })
    log.info({ count: tags.length }, 'Tags listed')
    return tags.map((t) => ({ id: t.id, name: t.name, color: t.color?.background }))
  }

  async createLabel(params: { name: string; color?: string }): Promise<Label> {
    log.debug({ name: params.name }, 'createLabel')
    const tag = await youtrackFetch<YtTag>(this.config, 'POST', '/api/tags', {
      body: { name: params.name },
      query: { fields: TAG_FIELDS },
    })
    log.info({ tagId: tag.id, name: tag.name }, 'Tag created')
    return { id: tag.id, name: tag.name, color: tag.color?.background }
  }

  async updateLabel(labelId: string, params: { name?: string; color?: string }): Promise<Label> {
    log.debug({ labelId }, 'updateLabel')
    const body: Record<string, unknown> = {}
    if (params.name !== undefined) body['name'] = params.name
    const tag = await youtrackFetch<YtTag>(this.config, 'POST', `/api/tags/${labelId}`, {
      body,
      query: { fields: TAG_FIELDS },
    })
    log.info({ tagId: tag.id }, 'Tag updated')
    return { id: tag.id, name: tag.name, color: tag.color?.background }
  }

  async removeLabel(labelId: string): Promise<{ id: string }> {
    log.debug({ labelId }, 'removeLabel')
    await youtrackFetch(this.config, 'DELETE', `/api/tags/${labelId}`)
    log.info({ labelId }, 'Tag deleted')
    return { id: labelId }
  }

  async addTaskLabel(taskId: string, labelId: string): Promise<{ taskId: string; labelId: string }> {
    log.debug({ taskId, labelId }, 'addTaskLabel')
    const issue = await youtrackFetch<{ tags?: YtTag[] }>(this.config, 'GET', `/api/issues/${taskId}`, {
      query: { fields: 'id,tags(id)' },
    })
    const currentTagIds = (issue.tags ?? []).map((t) => ({ id: t.id }))
    currentTagIds.push({ id: labelId })
    await youtrackFetch(this.config, 'POST', `/api/issues/${taskId}`, {
      body: { tags: currentTagIds },
      query: { fields: 'id' },
    })
    log.info({ taskId, labelId }, 'Tag added to issue')
    return { taskId, labelId }
  }

  async removeTaskLabel(taskId: string, labelId: string): Promise<{ taskId: string; labelId: string }> {
    log.debug({ taskId, labelId }, 'removeTaskLabel')
    const issue = await youtrackFetch<{ tags?: YtTag[] }>(this.config, 'GET', `/api/issues/${taskId}`, {
      query: { fields: 'id,tags(id)' },
    })
    const filteredTags = (issue.tags ?? []).filter((t) => t.id !== labelId).map((t) => ({ id: t.id }))
    await youtrackFetch(this.config, 'POST', `/api/issues/${taskId}`, {
      body: { tags: filteredTags },
      query: { fields: 'id' },
    })
    log.info({ taskId, labelId }, 'Tag removed from issue')
    return { taskId, labelId }
  }

  async addRelation(
    taskId: string,
    relatedTaskId: string,
    type: RelationType,
  ): Promise<{ taskId: string; relatedTaskId: string; type: string }> {
    log.debug({ taskId, relatedTaskId, type }, 'addRelation')
    const command = buildLinkCommand(type, relatedTaskId)
    await youtrackFetch(this.config, 'POST', `/api/issues/${taskId}/execute`, {
      body: { query: command },
    })
    log.info({ taskId, relatedTaskId, type }, 'Relation added')
    return { taskId, relatedTaskId, type }
  }

  async removeRelation(taskId: string, relatedTaskId: string): Promise<{ taskId: string; relatedTaskId: string }> {
    log.debug({ taskId, relatedTaskId }, 'removeRelation')
    const issue = await youtrackFetch<YtIssue>(this.config, 'GET', `/api/issues/${taskId}`, {
      query: { fields: 'id,links(id,direction,linkType(name),issues(id,idReadable))' },
    })
    const matchingLink = (issue.links ?? []).find((link) =>
      (link.issues ?? []).some((i) => i.id === relatedTaskId || i.idReadable === relatedTaskId),
    )
    if (matchingLink === undefined) {
      const err = providerError.relationNotFound(taskId, relatedTaskId)
      throw new ProviderClassifiedError(`Relation not found: ${taskId} -> ${relatedTaskId}`, err)
    }
    const typeName = matchingLink.linkType?.name ?? 'relates to'
    const removeCmd = buildRemoveLinkCommand(typeName, matchingLink.direction, relatedTaskId)
    await youtrackFetch(this.config, 'POST', `/api/issues/${taskId}/execute`, {
      body: { query: removeCmd },
    })
    log.info({ taskId, relatedTaskId }, 'Relation removed')
    return { taskId, relatedTaskId }
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
