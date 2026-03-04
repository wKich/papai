import { tool } from 'ai'
import type { ToolSet } from 'ai'
import { z } from 'zod'

import { removeIssueLabel } from '../linear/index.js'
import { logger } from '../logger.js'

export function makeRemoveIssueLabelTool(linearKey: string): ToolSet[string] {
  return tool({
    description: 'Remove a label from a Linear issue. Use this when the user wants to remove a label from an issue.',
    inputSchema: z.object({
      issueId: z.string().describe("The Linear issue ID (e.g. 'abc123')"),
      labelId: z.string().describe('The label ID to remove. Call get_issue_labels first to get available label IDs.'),
    }),
    execute: async ({ issueId, labelId }) => {
      try {
        const result = await removeIssueLabel({ apiKey: linearKey, issueId, labelId })
        if (!result) {
          logger.warn({ issueId, labelId }, 'removeIssueLabel returned no result')
        }
        return result ?? { success: false, message: 'Failed to remove label' }
      } catch (error) {
        logger.error(
          {
            error: error instanceof Error ? error.message : String(error),
            issueId,
            labelId,
            tool: 'remove_issue_label',
          },
          'Tool execution failed',
        )
        throw error
      }
    },
  })
}
