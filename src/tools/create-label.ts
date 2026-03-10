import { tool } from 'ai'
import type { ToolSet } from 'ai'
import { z } from 'zod'

import type { KaneoConfig } from '../kaneo/client.js'
import { createLabel } from '../kaneo/index.js'
import { logger } from '../logger.js'

const log = logger.child({ scope: 'tool:create-label' })

export function makeCreateLabelTool(kaneoConfig: KaneoConfig, workspaceId: string): ToolSet[string] {
  return tool({
    description: 'Create a new label in the workspace.',
    inputSchema: z.object({
      name: z.string().describe('Label name'),
      color: z.string().optional().describe("Hex color code (e.g. '#ff0000')"),
    }),
    execute: async ({ name, color }) => {
      try {
        return await createLabel({ config: kaneoConfig, workspaceId, name, color })
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
