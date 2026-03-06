import { tool } from 'ai'
import type { ToolSet } from 'ai'
import { z } from 'zod'

import { createLabel } from '../huly/index.js'
import { logger } from '../logger.js'

const log = logger.child({ scope: 'tool:create-label' })

export function makeCreateLabelTool(userId: number): ToolSet[string] {
  return tool({
    description: 'Create a new label in the team.',
    inputSchema: z.object({
      name: z.string().describe('Label name'),
      color: z.string().optional().describe("Hex color code (e.g. '#ff0000')"),
    }),
    execute: async ({ name, color }) => {
      try {
        return await createLabel({ userId, name, color })
      } catch (error) {
        log.error(
          { error: error instanceof Error ? error.message : String(error), name, tool: 'create_label' },
          'Tool execution failed',
        )
        throw error
      }
    },
  })
}
