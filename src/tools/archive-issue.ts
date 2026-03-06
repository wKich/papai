import { tool } from 'ai'
import type { ToolSet } from 'ai'
import { z } from 'zod'

import { archiveIssue } from '../huly/index.js'
import { logger } from '../logger.js'

const log = logger.child({ scope: 'tool:archive-issue' })

export function makeArchiveIssueTool(userId: number): ToolSet[string] {
  return tool({
    description:
      'Archive an issue. Use this when the user wants to archive/delete an issue. Archived issues can be restored later.',
    inputSchema: z.object({
      issueId: z.string().describe("The issue ID to archive (e.g. 'abc123')"),
    }),
    execute: async ({ issueId }) => {
      try {
        const result = await archiveIssue({ userId, issueId })
        if (!result) {
          log.warn({ issueId }, 'archiveIssue returned no result')
        }
        return result ?? { success: false, message: 'Failed to archive issue' }
      } catch (error) {
        log.error(
          { error: error instanceof Error ? error.message : String(error), issueId, tool: 'archive_issue' },
          'Tool execution failed',
        )
        throw error
      }
    },
  })
}
