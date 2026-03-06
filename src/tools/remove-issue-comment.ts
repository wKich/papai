import { tool } from 'ai'
import type { ToolSet } from 'ai'
import { z } from 'zod'

import { removeIssueComment } from '../linear/index.js'
import { logger } from '../logger.js'

const log = logger.child({ scope: 'tool:remove-issue-comment' })

export function makeRemoveIssueCommentTool(linearKey: string): ToolSet[string] {
  return tool({
    description: 'Remove (delete) a comment from a Linear issue.',
    inputSchema: z.object({
      commentId: z.string().describe('Linear comment ID to remove'),
    }),
    execute: async ({ commentId }) => {
      try {
        return await removeIssueComment({ apiKey: linearKey, commentId })
      } catch (error) {
        log.error(
          { error: error instanceof Error ? error.message : String(error), commentId, tool: 'remove_issue_comment' },
          'Tool execution failed',
        )
        throw error
      }
    },
  })
}
