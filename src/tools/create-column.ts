import { tool } from 'ai'
import type { ToolSet } from 'ai'
import { z } from 'zod'

import type { KaneoConfig } from '../kaneo/client.js'
import { createColumn } from '../kaneo/index.js'
import { logger } from '../logger.js'

const log = logger.child({ scope: 'tool:create-column' })

export function makeCreateColumnTool(kaneoConfig: KaneoConfig): ToolSet[string] {
  return tool({
    description: 'Create a new status column in a Kaneo project.',
    inputSchema: z.object({
      projectId: z.string().describe('Kaneo project ID'),
      name: z.string().describe('Column name (e.g., "In Progress", "Review", "Done")'),
      icon: z.string().optional().describe('Optional icon name for the column'),
      color: z.string().optional().describe('Optional hex color code (e.g., "#ff0000")'),
      isFinal: z.boolean().optional().describe('Whether this is a final/terminal column (default: false)'),
    }),
    execute: async ({ projectId, name, icon, color, isFinal }) => {
      try {
        return await createColumn({ config: kaneoConfig, projectId, name, icon, color, isFinal })
      } catch (error) {
        log.error(
          { error: error instanceof Error ? error.message : String(error), projectId, name, tool: 'create_column' },
          'Tool execution failed',
        )
        throw error
      }
    },
  })
}
