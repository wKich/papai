import { tool } from 'ai'
import type { ToolSet } from 'ai'
import { z } from 'zod'

import { removeIssueComment } from '../linear/index.js'
import { logger } from '../logger.js'

const log = logger.child({ scope: 'tool:remove-issue-comment' })

export function makeRemoveIssueCommentTool(userId: number): ToolSet[string] {
  return tool({
    description: 'Remove (delete) a comment from an issue.',
    inputSchema: z.object({
      commentId: z.string().describe('Comment ID to remove'),
    }),
    execute: async ({ commentId }) => {
      try {
        return await removeIssueComment({ userId, commentId })
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
