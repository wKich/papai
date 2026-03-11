import { tool } from 'ai'
import type { ToolSet } from 'ai'
import { z } from 'zod'

import type { KaneoConfig } from '../kaneo/client.js'
import { listColumns } from '../kaneo/index.js'
import { logger } from '../logger.js'

const log = logger.child({ scope: 'tool:list-columns' })

export function makeListColumnsTool(kaneoConfig: KaneoConfig): ToolSet[string] {
  return tool({
    description:
      'List all status columns in a Kaneo project. Use this to see available statuses before updating a task status.',
    inputSchema: z.object({
      projectId: z.string().describe('Kaneo project ID'),
    }),
    execute: async ({ projectId }) => {
      try {
        return await listColumns({ config: kaneoConfig, projectId })
      } catch (error) {
        log.error(
          { error: error instanceof Error ? error.message : String(error), projectId, tool: 'list_columns' },
          'Tool execution failed',
        )
        throw error
      }
    },
  })
}
