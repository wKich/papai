import { tool } from 'ai'
import type { ToolSet } from 'ai'
import { z } from 'zod'

import { searchIssues } from '../linear/index.js'
import { logger } from '../logger.js'

const log = logger.child({ scope: 'tool:search-issues' })

const searchIssuesInputSchema = z.object({
  query: z.string().optional().describe('Search keyword or phrase (optional if using filters)'),
  state: z.string().optional().describe("Filter by workflow state name (e.g. 'In Progress', 'Todo', 'Done')"),
  projectId: z.string().optional().describe('Filter by project ID'),
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
  hasRelations: z
    .boolean()
    .optional()
    .describe('Filter issues that have relations (blocks, blockedBy, duplicate, or related)'),
  relationType: z
    .enum(['blocks', 'blockedBy', 'duplicate', 'related'])
    .optional()
    .describe('Filter by specific relation type (requires hasRelations=true)'),
})

export function makeSearchIssuesTool(linearKey: string): ToolSet[string] {
  return tool({
    description:
      'Search for issues in Linear by keyword or filter by state, project, label, due date, estimate, or relations. Use this when the user asks about existing tasks.',
    inputSchema: searchIssuesInputSchema,
    execute: async ({
      query,
      state,
      projectId,
      labelName,
      labelId,
      dueDateBefore,
      dueDateAfter,
      estimate,
      hasRelations,
      relationType,
    }) => {
      try {
        return await searchIssues({
          apiKey: linearKey,
          query,
          state,
          projectId,
          labelName,
          labelId,
          dueDateBefore,
          dueDateAfter,
          estimate,
          hasRelations,
          relationType,
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
