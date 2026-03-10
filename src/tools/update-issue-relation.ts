import { tool } from 'ai'
import type { ToolSet } from 'ai'
import { z } from 'zod'

import { updateIssueRelation } from '../linear/index.js'
import { logger } from '../logger.js'

const log = logger.child({ scope: 'tool:update-issue-relation' })

export function makeUpdateIssueRelationTool(linearKey: string): ToolSet[string] {
  return tool({
    description: 'Update the type of an existing relation between two Linear issues.',
    inputSchema: z.object({
      issueId: z.string().describe('Linear issue ID'),
      relatedIssueId: z.string().describe('Linear issue ID of the related issue'),
      type: z
        .enum(['blocks', 'duplicate', 'related'])
        .describe("'blocks': this issue blocks the other; 'duplicate': marks as duplicate; 'related': general"),
    }),
    execute: async ({ issueId, relatedIssueId, type }) => {
      try {
        return await updateIssueRelation({ apiKey: linearKey, issueId, relatedIssueId, type })
      } catch (error) {
        log.error(
          {
            error: error instanceof Error ? error.message : String(error),
            issueId,
            relatedIssueId,
            tool: 'update_issue_relation',
          },
          'Tool execution failed',
        )
        throw error
      }
    },
  })
}
