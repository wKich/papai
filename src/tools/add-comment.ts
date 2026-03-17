import { tool } from 'ai'
import type { ToolSet } from 'ai'
import { z } from 'zod'

import { logger } from '../logger.js'
import type { TaskProvider } from '../providers/types.js'

const log = logger.child({ scope: 'tool:add-comment' })

export function makeAddCommentTool(provider: TaskProvider): ToolSet[string] {
  return tool({
    description: 'Add a comment to a Kaneo task.',
    inputSchema: z.object({
      taskId: z.string().describe('Kaneo task ID'),
      comment: z.string().describe('Comment text'),
    }),
    execute: async ({ taskId, comment }) => {
      try {
        return await provider.addComment!(taskId, comment)
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
