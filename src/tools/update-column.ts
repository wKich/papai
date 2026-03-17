import { tool } from 'ai'
import type { ToolSet } from 'ai'
import { z } from 'zod'

import { logger } from '../logger.js'
import type { TaskProvider } from '../providers/types.js'

const log = logger.child({ scope: 'tool:update-column' })

export function makeUpdateColumnTool(provider: TaskProvider): ToolSet[string] {
  return tool({
    description: 'Update an existing status column in a Kaneo project.',
    inputSchema: z
      .object({
        columnId: z.string().describe('Kaneo column ID'),
        name: z.string().optional().describe('New column name'),
        icon: z.string().optional().describe('New icon name'),
        color: z.string().optional().describe('New hex color code'),
        isFinal: z.boolean().optional().describe('Whether this is a final column'),
      })
      .refine(
        (data) =>
          data.name !== undefined || data.icon !== undefined || data.color !== undefined || data.isFinal !== undefined,
        'At least one field must be provided to update',
      ),
    execute: async ({ columnId, name, icon, color, isFinal }) => {
      try {
        return await provider.updateColumn!(columnId, { name, icon, color, isFinal })
      } catch (error) {
        log.error(
          { error: error instanceof Error ? error.message : String(error), columnId, tool: 'update_column' },
          'Tool execution failed',
        )
        throw error
      }
    },
  })
}
