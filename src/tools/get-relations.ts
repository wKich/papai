import { tool } from 'ai'
import type { ToolSet } from 'ai'
import { z } from 'zod'

import { getRelations } from '../linear/index.js'
import { logger } from '../logger.js'

export function makeGetRelationsTool(linearKey: string): ToolSet[string] {
  return tool({
    description: 'Get all relations on a Linear issue.',
    inputSchema: z.object({ issueId: z.string().describe('Linear issue ID') }),
    execute: async ({ issueId }) => {
      try {
        return await getRelations({ apiKey: linearKey, issueId })
      } catch (error) {
        logger.error(
          { error: error instanceof Error ? error.message : String(error), issueId, tool: 'get_relations' },
          'Tool execution failed',
        )
        throw error
      }
    },
  })
}
