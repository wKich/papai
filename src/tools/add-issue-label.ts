import { tool } from 'ai'
import type { ToolSet } from 'ai'
import { z } from 'zod'

import { addIssueLabel } from '../linear/index.js'
import { logger } from '../logger.js'

const log = logger.child({ scope: 'tool:add-issue-label' })

export function makeAddIssueLabelTool(linearKey: string): ToolSet[string] {
  return tool({
    description: 'Add a label to a Linear issue. Use list_labels first to get available label IDs.',
    inputSchema: z.object({
      issueId: z.string().describe('Linear issue ID'),
      labelId: z.string().describe('Label ID to add'),
    }),
    execute: async ({ issueId, labelId }) => {
      try {
        return await addIssueLabel({ apiKey: linearKey, issueId, labelId })
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
