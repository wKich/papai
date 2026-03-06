import { tool } from 'ai'
import type { ToolSet } from 'ai'
import { z } from 'zod'

import { removeLabel } from '../linear/index.js'
import { logger } from '../logger.js'

const log = logger.child({ scope: 'tool:remove-label' })

export function makeRemoveLabelTool(userId: number): ToolSet[string] {
  return tool({
    description: 'Remove (delete) an issue label.',
    inputSchema: z.object({
      labelId: z.string().describe('Label ID to remove'),
    }),
    execute: async ({ labelId }) => {
      try {
        return await removeLabel({ userId, labelId })
      } catch (error) {
        log.error(
          { error: error instanceof Error ? error.message : String(error), labelId, tool: 'remove_label' },
          'Tool execution failed',
        )
        throw error
      }
    },
  })
}
