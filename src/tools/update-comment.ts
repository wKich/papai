import { tool } from 'ai'
import type { ToolSet } from 'ai'
import { z } from 'zod'

import type { KaneoConfig } from '../kaneo/client.js'
import { updateComment } from '../kaneo/index.js'
import { logger } from '../logger.js'

const log = logger.child({ scope: 'tool:update-comment' })

export function makeUpdateCommentTool(kaneoConfig: KaneoConfig): ToolSet[string] {
  return tool({
    description: 'Update an existing comment on a Kaneo task.',
    inputSchema: z.object({
      taskId: z.string().describe('Kaneo task ID the comment belongs to'),
      activityId: z.string().describe('Kaneo activity/comment ID'),
      comment: z.string().describe('New comment text'),
    }),
    execute: async ({ taskId, activityId, comment }) => {
      try {
        return await updateComment({ config: kaneoConfig, taskId, activityId, comment })
      } catch (error) {
        log.error(
          { error: error instanceof Error ? error.message : String(error), activityId, tool: 'update_comment' },
          'Tool execution failed',
        )
        throw error
      }
    },
  })
}
