import { tool } from 'ai'
import type { ToolSet } from 'ai'
import { z } from 'zod'

import { logger } from '../logger.js'
import type { TaskProvider } from '../providers/types.js'

const log = logger.child({ scope: 'tool:reorder-columns' })

export function makeReorderColumnsTool(provider: TaskProvider): ToolSet[string] {
  return tool({
    description: 'Reorder status columns in a Kaneo project. Provide the new order of columns with their positions.',
    inputSchema: z.object({
      projectId: z.string().describe('Kaneo project ID'),
      columns: z
        .array(
          z.object({
            id: z.string().describe('Column ID'),
            position: z.number().describe('New position (0-indexed)'),
          }),
        )
        .describe('Array of columns with their new positions'),
    }),
    execute: async ({ projectId, columns }) => {
      try {
        await provider.reorderColumns!(projectId, columns)
        log.info({ projectId, columnCount: columns.length }, 'Columns reordered via tool')
        return { success: true }
      } catch (error) {
        log.error(
          { error: error instanceof Error ? error.message : String(error), projectId, tool: 'reorder_columns' },
          'Tool execution failed',
        )
        throw error
      }
    },
  })
}
