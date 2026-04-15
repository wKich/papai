import { z } from 'zod'

import { logger } from '../../../logger.js'
import type { Agile, Sprint } from '../../types.js'
import { classifyYouTrackError } from '../classify-error.js'
import type { YouTrackConfig } from '../client.js'
import { youtrackFetch } from '../client.js'
import { AGILE_FIELDS, SPRINT_FIELDS } from '../constants.js'
import { paginate } from '../helpers.js'
import { mapAgile, mapSprint } from '../mappers.js'
import { AgileSchema, AgileWithSprintsSchema } from '../schemas/agile.js'
import type { YouTrackAgileWithSprints } from '../schemas/agile.js'
import { SprintSchema } from '../schemas/sprint.js'

const log = logger.child({ scope: 'provider:youtrack:agiles' })

const IssueIdSchema = z.object({
  id: z.string(),
})

const parseSprintTimestamp = (value: string, field: 'start' | 'finish'): number => {
  const timestamp = new Date(value).getTime()
  if (Number.isNaN(timestamp)) {
    throw new Error(`Invalid sprint ${field} datetime: ${value}`)
  }
  return timestamp
}

export async function listYouTrackAgiles(config: YouTrackConfig): Promise<Agile[]> {
  log.debug({}, 'listAgiles')
  try {
    const agiles = await paginate(config, '/api/agiles', { fields: AGILE_FIELDS }, AgileSchema.array())
    log.info({ count: agiles.length }, 'Agiles listed')
    return agiles.map(mapAgile)
  } catch (error) {
    log.error({ error: error instanceof Error ? error.message : String(error) }, 'Failed to list agiles')
    throw classifyYouTrackError(error)
  }
}

export async function listYouTrackSprints(config: YouTrackConfig, agileId: string): Promise<Sprint[]> {
  log.debug({ agileId }, 'listSprints')
  try {
    const sprints = await paginate(
      config,
      `/api/agiles/${agileId}/sprints`,
      { fields: SPRINT_FIELDS },
      SprintSchema.array(),
    )
    log.info({ agileId, count: sprints.length }, 'Sprints listed')
    return sprints.map((sprint) => mapSprint(sprint, agileId))
  } catch (error) {
    log.error({ error: error instanceof Error ? error.message : String(error), agileId }, 'Failed to list sprints')
    throw classifyYouTrackError(error)
  }
}

export async function createYouTrackSprint(
  config: YouTrackConfig,
  agileId: string,
  params: {
    name: string
    goal?: string
    start?: string
    finish?: string
    previousSprintId?: string
    isDefault?: boolean
  },
): Promise<Sprint> {
  log.debug({ agileId, name: params.name }, 'createSprint')
  try {
    const body: Record<string, unknown> = { name: params.name }
    if (params.goal !== undefined) body['goal'] = params.goal
    if (params.start !== undefined) body['start'] = parseSprintTimestamp(params.start, 'start')
    if (params.finish !== undefined) body['finish'] = parseSprintTimestamp(params.finish, 'finish')
    if (params.previousSprintId !== undefined) body['previousSprint'] = { id: params.previousSprintId }
    if (params.isDefault !== undefined) body['isDefault'] = params.isDefault

    const raw = await youtrackFetch(config, 'POST', `/api/agiles/${agileId}/sprints`, {
      body,
      query: { fields: SPRINT_FIELDS },
    })
    const sprint = SprintSchema.parse(raw)
    log.info({ agileId, sprintId: sprint.id }, 'Sprint created')
    return mapSprint(sprint, agileId)
  } catch (error) {
    log.error({ error: error instanceof Error ? error.message : String(error), agileId }, 'Failed to create sprint')
    throw classifyYouTrackError(error)
  }
}

export async function updateYouTrackSprint(
  config: YouTrackConfig,
  agileId: string,
  sprintId: string,
  params: {
    name?: string
    goal?: string | null
    start?: string | null
    finish?: string | null
    previousSprintId?: string | null
    isDefault?: boolean
    archived?: boolean
  },
): Promise<Sprint> {
  log.debug({ agileId, sprintId }, 'updateSprint')
  try {
    const body: Record<string, unknown> = {}
    if (params.name !== undefined) body['name'] = params.name
    if (params.goal !== undefined) body['goal'] = params.goal
    if (params.start !== undefined) {
      if (params.start === null) body['start'] = null
      else body['start'] = parseSprintTimestamp(params.start, 'start')
    }
    if (params.finish !== undefined) {
      if (params.finish === null) body['finish'] = null
      else body['finish'] = parseSprintTimestamp(params.finish, 'finish')
    }
    if (params.previousSprintId !== undefined) {
      if (params.previousSprintId === null) body['previousSprint'] = null
      else body['previousSprint'] = { id: params.previousSprintId }
    }
    if (params.isDefault !== undefined) body['isDefault'] = params.isDefault
    if (params.archived !== undefined) body['archived'] = params.archived

    const raw = await youtrackFetch(config, 'POST', `/api/agiles/${agileId}/sprints/${sprintId}`, {
      body,
      query: { fields: SPRINT_FIELDS },
    })
    const sprint = SprintSchema.parse(raw)
    log.info({ agileId, sprintId: sprint.id }, 'Sprint updated')
    return mapSprint(sprint, agileId)
  } catch (error) {
    log.error(
      { error: error instanceof Error ? error.message : String(error), agileId, sprintId },
      'Failed to update sprint',
    )
    throw classifyYouTrackError(error)
  }
}

export async function assignYouTrackTaskToSprint(
  config: YouTrackConfig,
  taskId: string,
  sprintId: string,
): Promise<{ taskId: string; sprintId: string }> {
  log.debug({ taskId, sprintId }, 'assignTaskToSprint')
  try {
    const issueRaw = await youtrackFetch(config, 'GET', `/api/issues/${taskId}`, {
      query: { fields: 'id' },
    })
    const issueDbId = IssueIdSchema.parse(issueRaw).id

    const agiles: YouTrackAgileWithSprints[] = await paginate(
      config,
      '/api/agiles',
      { fields: 'id,sprints(id)' },
      AgileWithSprintsSchema.array(),
    )
    const agile = agiles.find((candidate) => (candidate.sprints ?? []).some((sprint) => sprint.id === sprintId))
    if (agile === undefined) {
      throw new Error(`Sprint ${sprintId} not found in any agile board`)
    }

    await youtrackFetch(config, 'POST', `/api/agiles/${agile.id}/sprints/${sprintId}/issues`, {
      body: { id: issueDbId, $type: 'Issue' },
    })
    log.info({ taskId, sprintId, agileId: agile.id }, 'Task assigned to sprint')
    return { taskId, sprintId }
  } catch (error) {
    log.error(
      { error: error instanceof Error ? error.message : String(error), taskId, sprintId },
      'Failed to assign task to sprint',
    )
    throw classifyYouTrackError(error, { taskId })
  }
}
