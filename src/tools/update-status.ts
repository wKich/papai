import { tool } from 'ai'
import type { ToolSet } from 'ai'
import { z } from 'zod'

import { logger } from '../logger.js'
import type { TaskProvider } from '../providers/types.js'

const log = logger.child({ scope: 'tool:update-status' })

export function makeUpdateStatusTool(provider: TaskProvider): ToolSet[string] {
  return tool({
    description: 'Update an existing status in a project.',
    inputSchema: z
      .object({
        statusId: z.string().describe('Status ID'),
        name: z.string().optional().describe('New status name'),
        icon: z.string().optional().describe('New icon name'),
        color: z.string().optional().describe('New hex color code'),
        isFinal: z.boolean().optional().describe('Whether this is a final status'),
      })
      .refine(
        (data) =>
          data.name !== undefined || data.icon !== undefined || data.color !== undefined || data.isFinal !== undefined,
        'At least one field must be provided to update',
      ),
    execute: async ({ statusId, name, icon, color, isFinal }) => {
      try {
        return await provider.updateStatus!(statusId, { name, icon, color, isFinal })
      } catch (error) {
        log.error(
          { error: error instanceof Error ? error.message : String(error), statusId, tool: 'update_status' },
          'Tool execution failed',
        )
        throw error
      }
    },
  })
}
