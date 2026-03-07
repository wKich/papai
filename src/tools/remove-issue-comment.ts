import { tool } from 'ai'
import type { ToolSet } from 'ai'
import { z } from 'zod'

import { removeIssueComment } from '../huly/index.js'
import { logger } from '../logger.js'

const log = logger.child({ scope: 'tool:remove-issue-comment' })

export function makeRemoveIssueCommentTool(userId: number): ToolSet[string] {
  return tool({
    description: 'Remove (delete) a comment from an issue.',
    inputSchema: z.object({
      commentId: z.string().describe('Comment ID to remove'),
      issueId: z.string().describe('Issue ID that the comment belongs to'),
      projectId: z.string().describe('Project ID that the issue belongs to'),
    }),
    execute: async ({ commentId, issueId, projectId }) => {
      try {
        return await removeIssueComment({ userId, commentId, issueId, projectId })
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
