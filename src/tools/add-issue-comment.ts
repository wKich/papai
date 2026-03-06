import { tool } from 'ai'
import type { ToolSet } from 'ai'
import { z } from 'zod'

import { addIssueComment } from '../linear/index.js'
import { logger } from '../logger.js'

const log = logger.child({ scope: 'tool:add-issue-comment' })

export function makeAddIssueCommentTool(userId: number): ToolSet[string] {
  return tool({
    description: 'Add a comment to an issue.',
    inputSchema: z.object({
      issueId: z.string().describe('Issue ID'),
      body: z.string().describe('Comment body (supports Markdown)'),
    }),
    execute: async ({ issueId, body }) => {
      try {
        return await addIssueComment({ userId, issueId, body })
      } catch (error) {
        log.error(
          { error: error instanceof Error ? error.message : String(error), issueId, tool: 'add_issue_comment' },
          'Tool execution failed',
        )
        throw error
      }
    },
  })
}
