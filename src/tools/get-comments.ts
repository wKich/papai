import { tool } from 'ai'
import type { ToolSet } from 'ai'
import { z } from 'zod'

import { logger } from '../logger.js'
import type { TaskProvider } from '../providers/types.js'

const log = logger.child({ scope: 'tool:get-comments' })

export function makeGetCommentsTool(provider: TaskProvider): ToolSet[string] {
  return tool({
    description: 'Get all comments on a task.',
    inputSchema: z.object({ taskId: z.string().describe('Task ID') }),
    execute: async ({ taskId }) => {
      try {
        return await provider.getComments!(taskId)
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
