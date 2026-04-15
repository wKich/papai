import { z } from 'zod'

import { logger } from '../../../logger.js'
import type { TaskCommandResult } from '../../types.js'
import { classifyYouTrackError } from '../classify-error.js'
import type { YouTrackConfig } from '../client.js'
import { youtrackFetch } from '../client.js'

const log = logger.child({ scope: 'provider:youtrack:commands' })

const CommandResponseSchema = z.object({
  query: z.string(),
  issues: z.array(z.object({ idReadable: z.string().optional(), id: z.string() })).optional(),
})

export async function applyYouTrackCommand(
  config: YouTrackConfig,
  params: { query: string; taskIds: string[]; comment?: string; silent?: boolean },
): Promise<TaskCommandResult> {
  log.debug({ query: params.query, taskIds: params.taskIds, silent: params.silent }, 'applyYouTrackCommand')
  try {
    const body: Record<string, unknown> = {
      query: params.query,
      issues: params.taskIds.map((taskId) => ({ idReadable: taskId })),
    }
    if (params.comment !== undefined) body['comment'] = params.comment
    if (params.silent !== undefined) body['silent'] = params.silent

    const raw = await youtrackFetch(config, 'POST', '/api/commands', {
      body,
      query: { fields: 'query,issues(id,idReadable)' },
    })
    const response = CommandResponseSchema.parse(raw)

    return {
      query: response.query,
      taskIds: (response.issues ?? []).map((issue) => issue.idReadable ?? issue.id),
      comment: params.comment,
      silent: params.silent,
    }
  } catch (error) {
    log.error(
      { error: error instanceof Error ? error.message : String(error), query: params.query },
      'Failed to apply command',
    )
    throw classifyYouTrackError(error)
  }
}
