import { tool } from 'ai'
import type { ToolSet } from 'ai'
import { z } from 'zod'

import type { KaneoConfig } from '../kaneo/client.js'
import { updateLabel } from '../kaneo/index.js'
import { logger } from '../logger.js'

const log = logger.child({ scope: 'tool:update-label' })

export function makeUpdateLabelTool(kaneoConfig: KaneoConfig): ToolSet[string] {
  return tool({
    description: 'Update an existing Kaneo label.',
    inputSchema: z
      .object({
        labelId: z.string().describe('Kaneo label ID'),
        name: z.string().optional().describe('New label name'),
        color: z.string().optional().describe('New label color (hex)'),
      })
      .refine(
        (data) => data.name !== undefined || data.color !== undefined,
        'At least one of name or color must be provided',
      ),
    execute: async ({ labelId, name, color }) => {
      try {
        return await updateLabel({ config: kaneoConfig, labelId, name, color })
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
