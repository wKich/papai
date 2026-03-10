import { tool } from 'ai'
import type { ToolSet } from 'ai'
import { z } from 'zod'

import { updateIssueComment } from '../linear/index.js'
import { logger } from '../logger.js'

const log = logger.child({ scope: 'tool:update-issue-comment' })

export function makeUpdateIssueCommentTool(linearKey: string): ToolSet[string] {
  return tool({
    description: 'Update an existing comment on a Linear issue.',
    inputSchema: z.object({
      commentId: z.string().describe('Linear comment ID'),
      body: z.string().describe('New comment body (supports Markdown)'),
    }),
    execute: async ({ commentId, body }) => {
      try {
        return await updateIssueComment({ apiKey: linearKey, commentId, body })
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
