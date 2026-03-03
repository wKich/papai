import { tool } from 'ai'
import type { ToolSet } from 'ai'
import { z } from 'zod'

import { getIssueLabels } from '../linear/index.js'
import { logger } from '../logger.js'

export function makeGetIssueLabelsTool(linearKey: string): ToolSet[string] {
  return tool({
    description: 'List labels currently applied to a specific issue.',
    inputSchema: z.object({ issueId: z.string().describe('Linear issue ID') }),
    execute: async ({ issueId }) => {
      try {
        return await getIssueLabels({ apiKey: linearKey, issueId })
      } catch (error) {
        logger.error(
          { error: error instanceof Error ? error.message : String(error), issueId, tool: 'get_issue_labels' },
          'Tool execution failed',
        )
        throw error
      }
    },
  })
}
