import { tool } from 'ai'
import type { ToolSet } from 'ai'
import { z } from 'zod'

import { getIssueComments } from '../huly/index.js'
import { logger } from '../logger.js'

const log = logger.child({ scope: 'tool:get-issue-comments' })

export function makeGetIssueCommentsTool(userId: number): ToolSet[string] {
  return tool({
    description: 'Get all comments on an issue.',
    inputSchema: z.object({ issueId: z.string().describe('Issue ID') }),
    execute: async ({ issueId }) => {
      try {
        return await getIssueComments({ userId, issueId })
      } catch (error) {
        log.error(
          { error: error instanceof Error ? error.message : String(error), issueId, tool: 'get_issue_comments' },
          'Tool execution failed',
        )
        throw error
      }
    },
  })
}
