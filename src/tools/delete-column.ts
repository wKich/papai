import { tool } from 'ai'
import type { ToolSet } from 'ai'
import { z } from 'zod'

import type { KaneoConfig } from '../kaneo/client.js'
import { deleteColumn } from '../kaneo/index.js'
import { logger } from '../logger.js'

const log = logger.child({ scope: 'tool:delete-column' })

export function makeDeleteColumnTool(kaneoConfig: KaneoConfig): ToolSet[string] {
  return tool({
    description: 'Delete a status column from a Kaneo project.',
    inputSchema: z.object({
      columnId: z.string().describe('Kaneo column ID to delete'),
    }),
    execute: async ({ columnId }) => {
      try {
        return await deleteColumn({ config: kaneoConfig, columnId })
      } catch (error) {
        log.error(
          { error: error instanceof Error ? error.message : String(error), columnId, tool: 'delete_column' },
          'Tool execution failed',
        )
        throw error
      }
    },
  })
}
