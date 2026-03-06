import { tool } from 'ai'
import type { ToolSet } from 'ai'
import { z } from 'zod'

import { updateLabel } from '../linear/index.js'
import { logger } from '../logger.js'

const log = logger.child({ scope: 'tool:update-label' })

export function makeUpdateLabelTool(userId: number): ToolSet[string] {
  return tool({
    description: 'Update an existing issue label.',
    inputSchema: z
      .object({
        labelId: z.string().describe('Label ID'),
        name: z.string().optional().describe('New label name'),
        description: z.string().optional().describe('New label description'),
        color: z.string().optional().describe('New label color (hex)'),
      })
      .refine(
        (data) => data.name !== undefined || data.description !== undefined || data.color !== undefined,
        'At least one of name, description, or color must be provided',
      ),
    execute: async ({ labelId, name, description, color }) => {
      try {
        return await updateLabel({ userId, labelId, name, description, color })
      } catch (error) {
        log.error(
          { error: error instanceof Error ? error.message : String(error), labelId, tool: 'update_label' },
          'Tool execution failed',
        )
        throw error
      }
    },
  })
}
