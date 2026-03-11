import { tool } from 'ai'
import type { ToolSet } from 'ai'
import { z } from 'zod'

import type { KaneoConfig } from '../kaneo/client.js'
import { getComments } from '../kaneo/index.js'
import { logger } from '../logger.js'

const log = logger.child({ scope: 'tool:get-comments' })

export function makeGetCommentsTool(kaneoConfig: KaneoConfig): ToolSet[string] {
  return tool({
    description: 'Get all comments on a Kaneo task.',
    inputSchema: z.object({ taskId: z.string().describe('Kaneo task ID') }),
    execute: async ({ taskId }) => {
      try {
        return await getComments({ config: kaneoConfig, taskId })
      } catch (error) {
        log.error(
          { error: error instanceof Error ? error.message : String(error), taskId, tool: 'get_comments' },
          'Tool execution failed',
        )
        throw error
      }
    },
  })
}
