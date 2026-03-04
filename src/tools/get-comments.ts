import { tool } from 'ai'
import type { ToolSet } from 'ai'
import { z } from 'zod'

import { getComments } from '../linear/index.js'
import { logger } from '../logger.js'

const log = logger.child({ scope: 'tool:get-comments' })

export function makeGetCommentsTool(linearKey: string): ToolSet[string] {
  return tool({
    description: 'Get all comments on a Linear issue.',
    inputSchema: z.object({ issueId: z.string().describe('Linear issue ID') }),
    execute: async ({ issueId }) => {
      try {
        return await getComments({ apiKey: linearKey, issueId })
      } catch (error) {
        log.error(
          { error: error instanceof Error ? error.message : String(error), issueId, tool: 'get_comments' },
          'Tool execution failed',
        )
        throw error
      }
    },
  })
}
