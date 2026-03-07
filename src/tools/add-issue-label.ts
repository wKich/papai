import { tool } from 'ai'
import type { ToolSet } from 'ai'
import { z } from 'zod'

import { addIssueLabel } from '../huly/index.js'
import { logger } from '../logger.js'

const log = logger.child({ scope: 'tool:add-issue-label' })

export function makeAddIssueLabelTool(userId: number): ToolSet[string] {
  return tool({
    description: 'Add a label to an issue. Use list_labels first to get available label IDs.',
    inputSchema: z.object({
      issueId: z.string().describe('Issue ID'),
      projectId: z.string().describe('Project ID where the issue belongs'),
      labelId: z.string().describe('Label ID to add'),
    }),
    execute: async ({ issueId, projectId, labelId }) => {
      try {
        return await addIssueLabel({ userId, issueId, projectId, labelId })
      } catch (error) {
        log.error(
          { error: error instanceof Error ? error.message : String(error), issueId, labelId, tool: 'add_issue_label' },
          'Tool execution failed',
        )
        throw error
      }
    },
  })
}
