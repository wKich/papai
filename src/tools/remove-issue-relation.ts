import { tool } from 'ai'
import type { ToolSet } from 'ai'
import { z } from 'zod'

import { removeIssueRelation } from '../linear/index.js'
import { logger } from '../logger.js'

const log = logger.child({ scope: 'tool:remove-issue-relation' })

export function makeRemoveIssueRelationTool(userId: number): ToolSet[string] {
  return tool({
    description: 'Remove a relation between two issues.',
    inputSchema: z.object({
      issueId: z.string().describe('Issue ID'),
      relatedIssueId: z.string().describe('Issue ID of the related issue'),
    }),
    execute: async ({ issueId, relatedIssueId }) => {
      try {
        return await removeIssueRelation({ userId, issueId, relatedIssueId })
      } catch (error) {
        log.error(
          {
            error: error instanceof Error ? error.message : String(error),
            issueId,
            relatedIssueId,
            tool: 'remove_issue_relation',
          },
          'Tool execution failed',
        )
        throw error
      }
    },
  })
}
