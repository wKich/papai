import { type Issue, type LinearFetch, LinearClient } from '@linear/sdk'

import { logger } from '../logger.js'
import { classifyLinearError } from './classify-error.js'

type UpdateInput = { stateId?: string; assigneeId?: string; dueDate?: string; labelIds?: string[]; estimate?: number }
type UpdateParams = { status?: string; assigneeId?: string; dueDate?: string; labelIds?: string[]; estimate?: number }

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
}: {
  apiKey: string
  issueId: string
  status?: string
  assigneeId?: string
  dueDate?: string
  labelIds?: string[]
  estimate?: number
}): Promise<LinearFetch<Issue> | undefined> {
  logger.debug({ issueId, status, assigneeId }, 'updateIssue called')

  try {
    const client = new LinearClient({ apiKey })
    const updateInput = await buildUpdateInput(client, issueId, { status, assigneeId, dueDate, labelIds, estimate })
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
