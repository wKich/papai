import { tool } from 'ai'
import type { ToolSet } from 'ai'
import { z } from 'zod'

import type { KaneoConfig } from '../kaneo/client.js'
import { removeComment } from '../kaneo/index.js'
import { logger } from '../logger.js'

const log = logger.child({ scope: 'tool:remove-comment' })

export function makeRemoveCommentTool(kaneoConfig: KaneoConfig): ToolSet[string] {
  return tool({
    description: 'Remove a comment from a Kaneo task.',
    inputSchema: z.object({
      activityId: z.string().describe('Kaneo activity/comment ID to remove'),
    }),
    execute: async ({ activityId }) => {
      try {
        return await removeComment({ config: kaneoConfig, activityId })
      } catch (error) {
        log.error(
          { error: error instanceof Error ? error.message : String(error), activityId, tool: 'remove_comment' },
          'Tool execution failed',
        )
        throw error
      }
    },
  })
}
