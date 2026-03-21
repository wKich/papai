import { logger } from '../../../logger.js'
import type { Task, TaskListItem, TaskSearchResult } from '../../types.js'
import { classifyYouTrackError } from '../classify-error.js'
import type { YouTrackConfig } from '../client.js'
import { youtrackFetch } from '../client.js'
import { ISSUE_FIELDS, ISSUE_LIST_FIELDS } from '../constants.js'
import { buildCustomFields, mapIssueToListItem, mapIssueToSearchResult, mapIssueToTask } from '../mappers.js'
import { IssueListSchema, IssueSchema } from '../schemas/issue.js'

const log = logger.child({ scope: 'provider:youtrack:tasks' })

export async function createYouTrackTask(
  config: YouTrackConfig,
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
  log.debug({ projectId: params.projectId, title: params.title }, 'createTask')
  try {
    const body: Record<string, unknown> = {
      project: { id: params.projectId },
      summary: params.title,
    }
    if (params.description !== undefined) body['description'] = params.description

    const customFields = buildCustomFields(params)
    if (customFields.length > 0) body['customFields'] = customFields

    const raw = await youtrackFetch(config, 'POST', '/api/issues', {
      body,
      query: { fields: ISSUE_FIELDS },
    })
    const issue = IssueSchema.parse(raw)
    log.info({ issueId: issue.idReadable ?? issue.id }, 'Issue created')
    return mapIssueToTask(issue, config.baseUrl)
  } catch (error) {
    log.error(
      { error: error instanceof Error ? error.message : String(error), projectId: params.projectId },
      'Failed to create task',
    )
    throw classifyYouTrackError(error, { projectId: params.projectId })
  }
}

export async function getYouTrackTask(config: YouTrackConfig, taskId: string): Promise<Task> {
  log.debug({ taskId }, 'getTask')
  try {
    const raw = await youtrackFetch(config, 'GET', `/api/issues/${taskId}`, {
      query: { fields: ISSUE_FIELDS },
    })
    const issue = IssueSchema.parse(raw)
    return mapIssueToTask(issue, config.baseUrl)
  } catch (error) {
    log.error({ error: error instanceof Error ? error.message : String(error), taskId }, 'Failed to get task')
    throw classifyYouTrackError(error, { taskId })
  }
}

export async function updateYouTrackTask(
  config: YouTrackConfig,
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
  try {
    const body: Record<string, unknown> = {}
    if (params.title !== undefined) body['summary'] = params.title
    if (params.description !== undefined) body['description'] = params.description
    if (params.projectId !== undefined) body['project'] = { id: params.projectId }

    const customFields = buildCustomFields(params)
    if (customFields.length > 0) body['customFields'] = customFields

    const raw = await youtrackFetch(config, 'POST', `/api/issues/${taskId}`, {
      body,
      query: { fields: ISSUE_FIELDS },
    })
    const issue = IssueSchema.parse(raw)
    log.info({ issueId: issue.idReadable ?? issue.id }, 'Issue updated')
    return mapIssueToTask(issue, config.baseUrl)
  } catch (error) {
    log.error({ error: error instanceof Error ? error.message : String(error), taskId }, 'Failed to update task')
    throw classifyYouTrackError(error, { taskId })
  }
}

export async function listYouTrackTasks(config: YouTrackConfig, projectId: string): Promise<TaskListItem[]> {
  log.debug({ projectId }, 'listTasks')
  try {
    const raw = await youtrackFetch(config, 'GET', '/api/issues', {
      query: { fields: ISSUE_LIST_FIELDS, query: `project: {${projectId}}`, $top: '100' },
    })
    const issues = IssueListSchema.array().parse(raw)
    log.info({ projectId, count: issues.length }, 'Tasks listed')
    return issues.map((issue) => mapIssueToListItem(issue, config.baseUrl))
  } catch (error) {
    log.error({ error: error instanceof Error ? error.message : String(error), projectId }, 'Failed to list tasks')
    throw classifyYouTrackError(error, { projectId })
  }
}

export async function searchYouTrackTasks(
  config: YouTrackConfig,
  params: { query: string; projectId?: string; limit?: number },
): Promise<TaskSearchResult[]> {
  log.debug({ query: params.query, projectId: params.projectId }, 'searchTasks')
  try {
    let query = params.query
    if (params.projectId !== undefined) {
      query = `project: {${params.projectId}} ${query}`
    }
    const raw = await youtrackFetch(config, 'GET', '/api/issues', {
      query: { fields: ISSUE_LIST_FIELDS, query, $top: String(params.limit ?? 50) },
    })
    const issues = IssueListSchema.array().parse(raw)
    log.info({ query: params.query, count: issues.length }, 'Tasks searched')
    return issues.map((issue) => mapIssueToSearchResult(issue, config.baseUrl))
  } catch (error) {
    log.error(
      {
        error: error instanceof Error ? error.message : String(error),
        query: params.query,
        projectId: params.projectId,
      },
      'Failed to search tasks',
    )
    const context = params.projectId === undefined ? undefined : { projectId: params.projectId }
    throw classifyYouTrackError(error, context)
  }
}

export async function deleteYouTrackTask(config: YouTrackConfig, taskId: string): Promise<{ id: string }> {
  log.debug({ taskId }, 'deleteTask')
  try {
    await youtrackFetch(config, 'DELETE', `/api/issues/${taskId}`)
    log.info({ taskId }, 'Issue deleted')
    return { id: taskId }
  } catch (error) {
    log.error({ error: error instanceof Error ? error.message : String(error), taskId }, 'Failed to delete task')
    throw classifyYouTrackError(error, { taskId })
  }
}
