import { z } from 'zod'

import { logger } from '../logger.js'
import { classifyKaneoError } from './classify-error.js'
import { type KaneoConfig, KaneoLabelSchema, kaneoFetch } from './client.js'

const log = logger.child({ scope: 'kaneo:list-labels' })

export type KaneoLabel = z.infer<typeof KaneoLabelSchema>

export async function listLabels({
  config,
  workspaceId,
}: {
  config: KaneoConfig
  workspaceId: string
}): Promise<KaneoLabel[]> {
  log.debug({ workspaceId }, 'listLabels called')

  try {
    const labels = await kaneoFetch(
      config,
      'GET',
      `/label/workspace/${workspaceId}`,
      undefined,
      undefined,
      z.array(KaneoLabelSchema),
    )
    log.info({ workspaceId, labelCount: labels.length }, 'Labels listed')
    return labels
  } catch (error) {
    log.error({ error: error instanceof Error ? error.message : String(error), workspaceId }, 'listLabels failed')
    throw classifyKaneoError(error)
  }
}
