import { z } from 'zod'

import { logger } from '../../../logger.js'
import type { ListTasksParams, Task, TaskListItem, TaskSearchResult } from '../../types.js'
import { classifyYouTrackError } from '../classify-error.js'
import type { YouTrackConfig } from '../client.js'
import { YouTrackApiError, youtrackFetch } from '../client.js'
import { ISSUE_FIELDS, ISSUE_LIST_FIELDS } from '../constants.js'
import { paginate } from '../helpers.js'
import { buildCustomFields, mapIssueToListItem, mapIssueToSearchResult, mapIssueToTask } from '../mappers.js'
import { IssueListSchema, IssueSchema } from '../schemas/issue.js'
import { getProjectRequiredFields } from './custom-fields.js'

const log = logger.child({ scope: 'provider:youtrack:tasks' })

const KNOWN_CUSTOM_FIELDS = new Set(['State', 'Priority', 'Assignee'])

async function validateRequiredFields(
  config: YouTrackConfig,
  projectId: string,
  projectShortName: string,
): Promise<void> {
  const requiredFields = await getProjectRequiredFields(config, projectId)
  const unhandled = requiredFields.filter((name) => !KNOWN_CUSTOM_FIELDS.has(name))
  if (unhandled.length > 0) {
    log.warn({ projectId, requiredFields: unhandled }, 'Missing required custom fields')
    throw new YouTrackApiError(
      `Project ${projectShortName} requires these custom fields: ${unhandled.join(', ')}`,
      400,
      {},
    )
  }
}

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
    const projectRaw = await youtrackFetch(config, 'GET', `/api/admin/projects/${params.projectId}`, {
      query: { fields: 'id,shortName' },
    })
    const project = z.object({ id: z.string(), shortName: z.string() }).parse(projectRaw)
    await validateRequiredFields(config, params.projectId, project.shortName)

    const body: Record<string, unknown> = {
      project: { id: project.id },
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

function fetchTasksWithPagination(
  config: YouTrackConfig,
  query: string,
  params: ListTasksParams | undefined,
): Promise<z.infer<typeof IssueListSchema>[]> {
  if (params?.limit !== undefined) {
    return fetchTasksManual(config, query, params)
  }
  return fetchTasksAuto(config, query)
}

function fetchTasksAuto(config: YouTrackConfig, query: string): Promise<z.infer<typeof IssueListSchema>[]> {
  return paginate(config, '/api/issues', { fields: ISSUE_LIST_FIELDS, query }, IssueListSchema.array(), 10, 100)
}

async function fetchTasksManual(
  config: YouTrackConfig,
  query: string,
  params: ListTasksParams,
): Promise<z.infer<typeof IssueListSchema>[]> {
  const limit = params.limit!
  const page = params.page ?? 1
  const skip = (page - 1) * limit

  const requestQuery: Record<string, string> = {
    fields: ISSUE_LIST_FIELDS,
    query,
    $top: String(limit),
  }

  if (skip > 0) {
    requestQuery['$skip'] = String(skip)
  }

  const raw = await youtrackFetch(config, 'GET', '/api/issues', {
    query: requestQuery,
  })
  return IssueListSchema.array().parse(raw)
}

function buildYouTrackQuery(params: ListTasksParams | undefined, projectShortName: string): string {
  const queryParts: string[] = [`project: {${projectShortName}}`]

  if (params?.status !== undefined) {
    queryParts.push(`State: {${params.status}}`)
  }

  if (params?.priority !== undefined) {
    queryParts.push(`Priority: {${params.priority}}`)
  }

  if (params?.assigneeId !== undefined) {
    queryParts.push(`Assignee: {${params.assigneeId}}`)
  }

  if (params?.dueAfter !== undefined) {
    queryParts.push(`Due date: >${params.dueAfter}`)
  }

  if (params?.dueBefore !== undefined) {
    queryParts.push(`Due date: <${params.dueBefore}`)
  }

  if (params?.sortBy !== undefined) {
    const sortField = params.sortBy === 'createdAt' ? 'created' : params.sortBy
    const sortOrder = params.sortOrder ?? 'asc'
    queryParts.push(`sort by: ${sortField} ${sortOrder}`)
  }

  return queryParts.join(' ')
}

export async function listYouTrackTasks(
  config: YouTrackConfig,
  projectId: string,
  params?: ListTasksParams,
): Promise<TaskListItem[]> {
  log.debug({ projectId, params }, 'listTasks')
  try {
    const projectRaw = await youtrackFetch(config, 'GET', `/api/admin/projects/${projectId}`, {
      query: { fields: 'shortName' },
    })
    const project = z.object({ shortName: z.string() }).parse(projectRaw)

    const query = buildYouTrackQuery(params, project.shortName)
    const issues = await fetchTasksWithPagination(config, query, params)

    log.info({ projectId, count: issues.length, filters: params }, 'Tasks listed')
    return issues.map((issue) => mapIssueToListItem(issue, config.baseUrl))
  } catch (error) {
    log.error({ error: error instanceof Error ? error.message : String(error), projectId }, 'Failed to list tasks')
    throw classifyYouTrackError(error, { projectId })
  }
}

export async function searchYouTrackTasks(
  config: YouTrackConfig,
  params: { query: string; projectId?: string; assigneeId?: string; limit?: number },
): Promise<TaskSearchResult[]> {
  log.debug({ query: params.query, projectId: params.projectId, assigneeId: params.assigneeId }, 'searchTasks')
  try {
    let query = params.query
    if (params.projectId !== undefined) {
      // Fetch project to get shortName - YouTrack search queries require shortName, not internal ID
      const projectRaw = await youtrackFetch(config, 'GET', `/api/admin/projects/${params.projectId}`, {
        query: { fields: 'shortName' },
      })
      const project = z.object({ shortName: z.string() }).parse(projectRaw)
      query = `project: {${project.shortName}} ${query}`
    }
    // Add assignee filter to YouTrack query syntax
    if (params.assigneeId !== undefined) {
      query = `assignee: {${params.assigneeId}} ${query}`
    }
    const raw = await youtrackFetch(config, 'GET', '/api/issues', {
      query: { fields: ISSUE_LIST_FIELDS, query, $top: String(params.limit ?? 50) },
    })
    const issues = IssueListSchema.array().parse(raw)
    log.info({ query: params.query, assigneeId: params.assigneeId, count: issues.length }, 'Tasks searched')
    return issues.map((issue) => mapIssueToSearchResult(issue, config.baseUrl))
  } catch (error) {
    log.error(
      {
        error: error instanceof Error ? error.message : String(error),
        query: params.query,
        projectId: params.projectId,
        assigneeId: params.assigneeId,
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
