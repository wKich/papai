import { tool } from 'ai'
import type { ToolSet } from 'ai'
import { z } from 'zod'

import type { KaneoConfig } from '../kaneo/client.js'
import { addComment } from '../kaneo/index.js'
import { logger } from '../logger.js'

const log = logger.child({ scope: 'tool:add-comment' })

export function makeAddCommentTool(kaneoConfig: KaneoConfig): ToolSet[string] {
  return tool({
    description: 'Add a comment to a Kaneo task.',
    inputSchema: z.object({
      taskId: z.string().describe('Kaneo task ID'),
      comment: z.string().describe('Comment text'),
    }),
    execute: async ({ taskId, comment }) => {
      try {
        return await addComment({ config: kaneoConfig, taskId, comment })
      } catch (error) {
        log.error(
          { error: error instanceof Error ? error.message : String(error), taskId, tool: 'add_comment' },
          'Tool execution failed',
        )
        throw error
      }
    },
  })
}
