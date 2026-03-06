import { tool } from 'ai'
import type { ToolSet } from 'ai'
import { z } from 'zod'

import { listLabels } from '../linear/index.js'
import { logger } from '../logger.js'

const log = logger.child({ scope: 'tool:list-labels' })

export function makeListLabelsTool(userId: number): ToolSet[string] {
  return tool({
    description: 'List all available labels in the team. Use this to get label IDs before applying labels.',
    inputSchema: z.object({}),
    execute: async () => {
      try {
        return await listLabels({ userId })
      } catch (error) {
        log.error(
          { error: error instanceof Error ? error.message : String(error), tool: 'list_labels' },
          'Tool execution failed',
        )
        throw error
      }
    },
  })
}
