import { tool } from 'ai'
import type { ToolSet } from 'ai'
import { z } from 'zod'

import { updateIssueComment } from '../huly/index.js'
import { logger } from '../logger.js'

const log = logger.child({ scope: 'tool:update-issue-comment' })

export function makeUpdateIssueCommentTool(userId: number): ToolSet[string] {
  return tool({
    description: 'Update an existing comment on an issue.',
    inputSchema: z.object({
      commentId: z.string().describe('Comment ID'),
      body: z.string().describe('New comment body (supports Markdown)'),
      issueId: z.string().describe('Issue ID that the comment belongs to'),
      projectId: z.string().describe('Project ID that the issue belongs to'),
    }),
    execute: async ({ commentId, body, issueId, projectId }) => {
      try {
        return await updateIssueComment({ userId, commentId, body, issueId, projectId })
      } catch (error) {
        log.error(
          { error: error instanceof Error ? error.message : String(error), commentId, tool: 'update_issue_comment' },
          'Tool execution failed',
        )
        throw error
      }
    },
  })
}
