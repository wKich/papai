import { type Issue, type LinearFetch, LinearClient } from '@linear/sdk'

import { linearError } from '../errors.js'
import { logger } from '../logger.js'
import { classifyLinearError } from './classify-error.js'
import { filterPresentNodes, requireEntity } from './response-guards.js'

const log = logger.child({ scope: 'linear:update-issue' })

type UpdateInput = {
  stateId?: string
  assigneeId?: string
  dueDate?: string
  labelIds?: string[]
  estimate?: number
  projectId?: string
}

type UpdateParams = {
  status?: string
  assigneeId?: string
  dueDate?: string
  labelIds?: string[]
  estimate?: number
  projectId?: string
}

const resolveWorkflowState = async (
  client: LinearClient,
  issueId: string,
  status: string,
): Promise<string | undefined> => {
  const issue = requireEntity(await client.issue(issueId), {
    entityName: 'issue',
    context: { issueId },
    appError: linearError.issueNotFound(issueId),
  })
  const team = requireEntity(await issue.team, {
    entityName: 'team',
    context: { issueId },
    appError: linearError.validationFailed('team', 'Missing team in issue response'),
  })
  const states = await team.states()
  const validStates = filterPresentNodes(states.nodes, { entityName: 'workflow-state', parentId: issueId }).flatMap(
    (s) => {
      if (typeof s.id !== 'string' || typeof s.name !== 'string') {
        log.warn(
          { issueId, requestedStatus: status, stateId: s.id },
          'Skipping workflow state with invalid response shape',
        )
        return []
      }
      return [s]
    },
  )
  const state = validStates.find((s) => s.name.toLowerCase() === status.toLowerCase())
  log.debug(
    { requestedStatus: status, foundState: state?.name, availableStates: validStates.map((s) => s.name) },
    'Resolving workflow state',
  )
  if (state) {
    return state.id
  }
  log.warn(
    { issueId, requestedStatus: status, availableStates: validStates.map((s) => s.name) },
    'Workflow state not found',
  )
  return undefined
}

const buildUpdateInput = async (client: LinearClient, issueId: string, params: UpdateParams): Promise<UpdateInput> => {
  const input: UpdateInput = {}
  if (params.status !== undefined) {
    const stateId = await resolveWorkflowState(client, issueId, params.status)
    if (stateId !== undefined) {
      input.stateId = stateId
    }
  }
  if (params.assigneeId !== undefined) {
    input.assigneeId = params.assigneeId
  }
  if (params.dueDate !== undefined) {
    input.dueDate = params.dueDate
  }
  if (params.labelIds !== undefined) {
    input.labelIds = params.labelIds
  }
  if (params.estimate !== undefined) {
    input.estimate = params.estimate
  }
  if (params.projectId !== undefined) {
    input.projectId = params.projectId
  }
  return input
}

export async function updateIssue({
  apiKey,
  issueId,
  status,
  assigneeId,
  dueDate,
  labelIds,
  estimate,
  projectId,
}: {
  apiKey: string
  issueId: string
  status?: string
  assigneeId?: string
  dueDate?: string
  labelIds?: string[]
  estimate?: number
  projectId?: string
}): Promise<LinearFetch<Issue> | undefined> {
  log.debug({ issueId, status, assigneeId, projectId }, 'updateIssue called')

  try {
    const client = new LinearClient({ apiKey })
    const updateInput = await buildUpdateInput(client, issueId, {
      status,
      assigneeId,
      dueDate,
      labelIds,
      estimate,
      projectId,
    })
    const payload = await client.updateIssue(issueId, updateInput)
    const issue = await payload.issue
    if (issue) {
      log.info({ issueId, identifier: issue.identifier, updatedFields: Object.keys(updateInput) }, 'Issue updated')
    }
    return await payload.issue
  } catch (error) {
    log.error({ error: error instanceof Error ? error.message : String(error), issueId }, 'updateIssue failed')
    throw classifyLinearError(error)
  }
}
