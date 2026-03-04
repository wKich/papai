import { tool } from 'ai'
import type { ToolSet } from 'ai'
import { z } from 'zod'

import { addComment } from '../linear/index.js'
import { logger } from '../logger.js'

const log = logger.child({ scope: 'tool:add-comment' })

export function makeAddCommentTool(linearKey: string): ToolSet[string] {
  return tool({
    description: 'Add a comment to a Linear issue.',
    inputSchema: z.object({
      issueId: z.string().describe('Linear issue ID'),
      body: z.string().describe('Comment body (supports Markdown)'),
    }),
    execute: async ({ issueId, body }) => {
      try {
        return await addComment({ apiKey: linearKey, issueId, body })
      } catch (error) {
        log.error(
          { error: error instanceof Error ? error.message : String(error), issueId, tool: 'add_comment' },
          'Tool execution failed',
        )
        throw error
      }
    },
  })
}
