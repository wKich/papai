import { tool } from 'ai'
import type { ToolSet } from 'ai'
import { z } from 'zod'

import { getIssueComments } from '../linear/index.js'
import { logger } from '../logger.js'

const log = logger.child({ scope: 'tool:get-issue-comments' })

export function makeGetIssueCommentsTool(linearKey: string): ToolSet[string] {
  return tool({
    description: 'Get all comments on a Linear issue.',
    inputSchema: z.object({ issueId: z.string().describe('Linear issue ID') }),
    execute: async ({ issueId }) => {
      try {
        return await getIssueComments({ apiKey: linearKey, issueId })
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
