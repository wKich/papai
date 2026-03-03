import { type Issue, type LinearFetch, LinearClient } from '@linear/sdk'

import { type AppError, linearError, systemError } from './errors.js'
import { logger } from './logger.js'

type IssueResult = { id: string; identifier: string; title: string; priority: number; url: string }

class LinearApiError extends Error {
  constructor(
    message: string,
    public readonly appError: AppError,
  ) {
    super(message)
    this.name = 'LinearApiError'
  }
}

const classifyLinearError = (error: unknown): LinearApiError => {
  if (error instanceof Error) {
    const message = error.message.toLowerCase()
    if (message.includes('not found') || message.includes('issue') || message.includes('resource')) {
      return new LinearApiError(error.message, linearError.issueNotFound('unknown'))
    }
    if (message.includes('authentication') || message.includes('unauthorized') || message.includes('auth')) {
      return new LinearApiError(error.message, linearError.authFailed())
    }
    if (message.includes('rate limit') || message.includes('ratelimit') || message.includes('429')) {
      return new LinearApiError(error.message, linearError.rateLimited())
    }
    if (message.includes('validation') || message.includes('invalid')) {
      return new LinearApiError(error.message, linearError.validationFailed('unknown', error.message))
    }
  }
  return new LinearApiError(
    error instanceof Error ? error.message : String(error),
    systemError.unexpected(error instanceof Error ? error : new Error(String(error))),
  )
}

const toIssueResult = (issue: Issue): IssueResult => ({
  id: issue.id,
  identifier: issue.identifier,
  title: issue.title,
  priority: issue.priority,
  url: issue.url,
})

const resolveWorkflowState = async (
  client: LinearClient,
  issueId: string,
  status: string,
): Promise<string | undefined> => {
  const issue = await client.issue(issueId)
  const team = await issue.team
  if (!team) {
    return undefined
  }

  const states = await team.states()
  const state = states.nodes.find((s) => s.name.toLowerCase() === status.toLowerCase())
  logger.debug(
    { requestedStatus: status, foundState: state?.name, availableStates: states.nodes.map((s) => s.name) },
    'Resolving workflow state',
  )

  if (state) {
    return state.id
  }

  logger.warn(
    { issueId, requestedStatus: status, availableStates: states.nodes.map((s) => s.name) },
    'Workflow state not found',
  )
  return undefined
}

export async function createIssue({
  apiKey,
  title,
  description,
  priority,
  projectId,
  teamId,
}: {
  apiKey: string
  title: string
  description?: string
  priority?: number
  projectId?: string
  teamId: string
}): Promise<LinearFetch<Issue> | undefined> {
  logger.debug(
    { title, hasDescription: description !== undefined, priority, hasProjectId: projectId !== undefined, teamId },
    'createIssue called',
  )

  try {
    const client = new LinearClient({ apiKey })
    const payload = await client.createIssue({
      title,
      description,
      priority,
      projectId,
      teamId,
    })
    const issue = await payload.issue
    if (issue) {
      logger.info({ issueId: issue.id, identifier: issue.identifier, title }, 'Issue created')
    }
    return await payload.issue
  } catch (error) {
    logger.error({ error: error instanceof Error ? error.message : String(error), title, teamId }, 'createIssue failed')
    throw classifyLinearError(error)
  }
}

export async function updateIssue({
  apiKey,
  issueId,
  status,
  assigneeId,
}: {
  apiKey: string
  issueId: string
  status?: string
  assigneeId?: string
}): Promise<LinearFetch<Issue> | undefined> {
  logger.debug(
    { issueId, hasStatus: status !== undefined, hasAssigneeId: assigneeId !== undefined },
    'updateIssue called',
  )

  try {
    const client = new LinearClient({ apiKey })
    const updateInput: { stateId?: string; assigneeId?: string } = {}

    if (status !== undefined) {
      const stateId = await resolveWorkflowState(client, issueId, status)
      if (stateId !== undefined) {
        updateInput.stateId = stateId
      }
    }

    if (assigneeId !== undefined) {
      updateInput.assigneeId = assigneeId
    }

    const payload = await client.updateIssue(issueId, updateInput)
    const issue = await payload.issue
    if (issue) {
      logger.info({ issueId, identifier: issue.identifier, updatedFields: Object.keys(updateInput) }, 'Issue updated')
    }
    return await payload.issue
  } catch (error) {
    logger.error({ error: error instanceof Error ? error.message : String(error), issueId }, 'updateIssue failed')
    throw classifyLinearError(error)
  }
}

export async function searchIssues({
  apiKey,
  query,
  state,
}: {
  apiKey: string
  query: string
  state?: string
}): Promise<IssueResult[]> {
  logger.debug({ query, state, includeArchived: false }, 'searchIssues called')

  try {
    const client = new LinearClient({ apiKey })
    const result = await client.issueSearch({ query, includeArchived: false })
    const issues = result.nodes
    logger.debug({ query, rawResultCount: issues.length }, 'Linear search completed')

    if (state !== undefined) {
      const filtered = await Promise.all(
        issues.map(async (issue) => {
          const issueState = await issue.state
          if (!issueState) {
            logger.warn({ issueId: issue.id, issueIdentifier: issue.identifier }, 'Issue has no state while filtering')
            return null
          }
          return issueState.name.toLowerCase() === state.toLowerCase() ? issue : null
        }),
      )
      const filteredIssues = filtered.filter(Boolean).map((issue) => toIssueResult(issue!))
      logger.info({ query, state, resultCount: filteredIssues.length }, 'Issues searched')
      return filteredIssues
    }

    const mappedIssues = issues.map(toIssueResult)
    logger.info({ query, resultCount: mappedIssues.length }, 'Issues searched')
    return mappedIssues
  } catch (error) {
    logger.error({ error: error instanceof Error ? error.message : String(error), query, state }, 'searchIssues failed')
    throw classifyLinearError(error)
  }
}

export async function listProjects({
  apiKey,
}: {
  apiKey: string
}): Promise<{ teamId: string; teamName: string; projects: { id: string; name: string }[] }[]> {
  logger.debug('listProjects called')

  try {
    const client = new LinearClient({ apiKey })
    const teams = await client.teams()
    const result = await Promise.all(
      teams.nodes.map(async (team) => {
        const projects = await team.projects()
        return {
          teamId: team.id,
          teamName: team.name,
          projects: projects.nodes.map((p) => ({ id: p.id, name: p.name })),
        }
      }),
    )
    logger.info(
      { teamCount: result.length, totalProjects: result.reduce((sum, t) => sum + t.projects.length, 0) },
      'Projects listed',
    )
    return result
  } catch (error) {
    logger.error({ error: error instanceof Error ? error.message : String(error) }, 'listProjects failed')
    throw classifyLinearError(error)
  }
}
