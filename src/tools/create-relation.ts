import { tool } from 'ai'
import type { ToolSet } from 'ai'
import { z } from 'zod'

import { createRelation } from '../linear/index.js'
import { logger } from '../logger.js'

export function makeCreateRelationTool(linearKey: string): ToolSet[string] {
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
        return await createRelation({ apiKey: linearKey, issueId, relatedIssueId, type })
      } catch (error) {
        logger.error(
          { error: error instanceof Error ? error.message : String(error), issueId, tool: 'create_relation' },
          'Tool execution failed',
        )
        throw error
      }
    },
  })
}
