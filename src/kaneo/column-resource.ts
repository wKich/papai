import { z } from 'zod'

import { logger } from '../logger.js'
import { classifyKaneoError } from './classify-error.js'
import { type KaneoConfig, KaneoColumnSchema, kaneoFetch } from './client.js'

export class ColumnResource {
  private log = logger.child({ scope: 'kaneo:column-resource' })

  constructor(private config: KaneoConfig) {}

  async list(projectId: string): Promise<z.infer<typeof KaneoColumnSchema>[]> {
    this.log.debug({ projectId }, 'Listing columns')

    try {
      const columns = await kaneoFetch(
        this.config,
        'GET',
        `/column/${projectId}`,
        undefined,
        undefined,
        z.array(KaneoColumnSchema),
      )
      this.log.info({ projectId, count: columns.length }, 'Columns listed')
      return columns
    } catch (error) {
      this.log.error({ error: error instanceof Error ? error.message : String(error) }, 'Failed to list columns')
      throw classifyKaneoError(error)
    }
  }
}
