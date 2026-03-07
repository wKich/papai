import { tool } from 'ai'
import type { ToolSet } from 'ai'
import { z } from 'zod'

import { removeIssueLabel } from '../huly/index.js'
import { logger } from '../logger.js'

const log = logger.child({ scope: 'tool:remove-issue-label' })

export function makeRemoveIssueLabelTool(userId: number): ToolSet[string] {
  return tool({
    description: 'Remove a label from an issue. Use this when the user wants to remove a label from an issue.',
    inputSchema: z.object({
      issueId: z.string().describe("The issue ID (e.g. 'abc123')"),
      projectId: z.string().describe('Project ID where the issue belongs'),
      labelId: z
        .string()
        .describe(
          "The label ID to remove. Call get_issue first to see the issue's labels, or list_labels to see all available labels.",
        ),
    }),
    execute: async ({ issueId, projectId, labelId }) => {
      try {
        const result = await removeIssueLabel({ userId, issueId, projectId, labelId })
        if (!result) {
          log.warn({ issueId, labelId }, 'removeIssueLabel returned no result')
        }
        return result ?? { success: false, message: 'Failed to remove label' }
      } catch (error) {
        log.error(
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
