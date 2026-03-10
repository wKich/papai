import { tool } from 'ai'
import type { ToolSet } from 'ai'
import { z } from 'zod'

import { addIssueRelation } from '../linear/index.js'
import { logger } from '../logger.js'

const log = logger.child({ scope: 'tool:add-issue-relation' })

export function makeAddIssueRelationTool(linearKey: string): ToolSet[string] {
  return tool({
    description: 'Create a relation between two Linear issues.',
    inputSchema: z.object({
      issueId: z.string().describe('Linear issue ID'),
      relatedIssueId: z.string().describe('Linear issue ID of the related issue'),
      type: z
        .enum(['blocks', 'duplicate', 'related'])
        .describe("'blocks': this issue blocks the other; 'duplicate': marks as duplicate; 'related': general"),
    }),
    execute: async ({ issueId, relatedIssueId, type }) => {
      try {
        return await addIssueRelation({ apiKey: linearKey, issueId, relatedIssueId, type })
      } catch (error) {
        log.error(
          { error: error instanceof Error ? error.message : String(error), issueId, tool: 'add_issue_relation' },
          'Tool execution failed',
        )
        throw error
      }
    },
  })
}
