import { type Issue, type LinearFetch, LinearClient } from '@linear/sdk'

import { logger } from './logger.js'

const client = new LinearClient({ apiKey: process.env['LINEAR_API_KEY']! })

type IssueResult = { id: string; identifier: string; title: string; priority: number; url: string }

export async function createIssue({
  title,
  description,
  priority,
  projectId,
  teamId,
}: {
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
  return payload.issue
}

export async function updateIssue({
  issueId,
  status,
  assigneeId,
}: {
  issueId: string
  status?: string
  assigneeId?: string
}): Promise<LinearFetch<Issue> | undefined> {
  logger.debug(
    { issueId, hasStatus: status !== undefined, hasAssigneeId: assigneeId !== undefined },
    'updateIssue called',
  )
  const updateInput: { stateId?: string; assigneeId?: string } = {}

  if (status !== undefined) {
    const issue = await client.issue(issueId)
    const team = await issue.team
    if (team) {
      const states = await team.states()
      const state = states.nodes.find((s) => s.name.toLowerCase() === status.toLowerCase())
      logger.debug(
        { requestedStatus: status, foundState: state?.name, availableStates: states.nodes.map((s) => s.name) },
        'Resolving workflow state',
      )
      if (state) {
        updateInput.stateId = state.id
      } else {
        logger.warn(
          { issueId, requestedStatus: status, availableStates: states.nodes.map((s) => s.name) },
          'Workflow state not found',
        )
      }
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
  return payload.issue
}

export async function searchIssues({ query, state }: { query: string; state?: string }): Promise<IssueResult[]> {
  logger.debug({ query, state, includeArchived: false }, 'searchIssues called')
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
    const filteredIssues = filtered.filter(Boolean).map((issue) => ({
      id: issue!.id,
      identifier: issue!.identifier,
      title: issue!.title,
      priority: issue!.priority,
      url: issue!.url,
    }))
    logger.info({ query, state, resultCount: filteredIssues.length }, 'Issues searched')
    return filteredIssues
  }

  const mappedIssues = issues.map((issue) => ({
    id: issue.id,
    identifier: issue.identifier,
    title: issue.title,
    priority: issue.priority,
    url: issue.url,
  }))
  logger.info({ query, resultCount: mappedIssues.length }, 'Issues searched')
  return mappedIssues
}

export async function listProjects(): Promise<
  { teamId: string; teamName: string; projects: { id: string; name: string }[] }[]
> {
  logger.debug('listProjects called')
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
}
