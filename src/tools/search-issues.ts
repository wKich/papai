import { tool } from 'ai'
import type { ToolSet } from 'ai'
import { z } from 'zod'

import { searchIssues } from '../huly/index.js'
import { logger } from '../logger.js'

const log = logger.child({ scope: 'tool:search-issues' })

const searchIssuesInputSchema = z.object({
  query: z.string().optional().describe('Search keyword or phrase (optional if using filters)'),
  state: z.string().optional().describe("Filter by workflow state name (e.g. 'In Progress', 'Todo', 'Done')"),
  projectId: z.string().describe('Filter by project ID'),
  labelName: z.string().optional().describe('Filter by label name (e.g. "Bug", "Feature")'),
  labelId: z.string().optional().describe('Filter by label ID (alternative to labelName)'),
  dueDateBefore: z
    .string()
    .optional()
    .describe("Filter issues due before this date (ISO 8601 format, e.g. '2026-03-15')"),
  dueDateAfter: z
    .string()
    .optional()
    .describe("Filter issues due after this date (ISO 8601 format, e.g. '2026-01-01')"),
  estimate: z.number().int().optional().describe('Filter by story point estimate (exact match)'),
})

export function makeSearchIssuesTool(userId: number): ToolSet[string] {
  return tool({
    description:
      'Search for issues by keyword or filter by state, project, label, due date, estimate, or relations. Use this when the user asks about existing tasks.',
    inputSchema: searchIssuesInputSchema,
    execute: async ({ query, state, projectId, labelName, labelId, dueDateBefore, dueDateAfter, estimate }) => {
      try {
        return await searchIssues({
          userId,
          query,
          state,
          projectId,
          labelName,
          labelId,
          dueDateBefore,
          dueDateAfter,
          estimate,
        })
      } catch (error) {
        log.error(
          { error: error instanceof Error ? error.message : String(error), query, tool: 'search_issues' },
          'Tool execution failed',
        )
        throw error
      }
    },
  })
}
