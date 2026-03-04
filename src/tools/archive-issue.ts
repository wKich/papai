import { tool } from 'ai'
import type { ToolSet } from 'ai'
import { z } from 'zod'

import { archiveIssue } from '../linear/index.js'
import { logger } from '../logger.js'

export function makeArchiveIssueTool(linearKey: string): ToolSet[string] {
  return tool({
    description:
      'Archive a Linear issue. Use this when the user wants to archive/delete an issue. Archived issues can be restored later.',
    inputSchema: z.object({
      issueId: z.string().describe("The Linear issue ID to archive (e.g. 'abc123')"),
    }),
    execute: async ({ issueId }) => {
      try {
        const result = await archiveIssue({ apiKey: linearKey, issueId })
        if (!result) {
          logger.warn({ issueId }, 'archiveIssue returned no result')
        }
        return result ?? { success: false, message: 'Failed to archive issue' }
      } catch (error) {
        logger.error(
          { error: error instanceof Error ? error.message : String(error), issueId, tool: 'archive_issue' },
          'Tool execution failed',
        )
        throw error
      }
    },
  })
}
