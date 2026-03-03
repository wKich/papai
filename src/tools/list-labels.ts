import { tool } from 'ai'
import type { ToolSet } from 'ai'
import { z } from 'zod'

import { listLabels } from '../linear/index.js'
import { logger } from '../logger.js'

export function makeListLabelsTool(linearKey: string, linearTeamId: string): ToolSet[string] {
  return tool({
    description: 'List all available labels in the team. Use this to get label IDs before applying labels.',
    inputSchema: z.object({}),
    execute: async () => {
      try {
        return await listLabels({ apiKey: linearKey, teamId: linearTeamId })
      } catch (error) {
        logger.error(
          { error: error instanceof Error ? error.message : String(error), tool: 'list_labels' },
          'Tool execution failed',
        )
        throw error
      }
    },
  })
}
