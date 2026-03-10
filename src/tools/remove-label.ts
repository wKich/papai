import { tool } from 'ai'
import type { ToolSet } from 'ai'
import { z } from 'zod'

import type { KaneoConfig } from '../kaneo/client.js'
import { removeLabel } from '../kaneo/index.js'
import { logger } from '../logger.js'

const log = logger.child({ scope: 'tool:remove-label' })

export function makeRemoveLabelTool(kaneoConfig: KaneoConfig): ToolSet[string] {
  return tool({
    description: 'Remove (delete) a Kaneo label.',
    inputSchema: z.object({
      labelId: z.string().describe('Kaneo label ID to remove'),
    }),
    execute: async ({ labelId }) => {
      try {
        return await removeLabel({ config: kaneoConfig, labelId })
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
