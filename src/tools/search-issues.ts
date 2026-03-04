import { tool } from 'ai'
import type { ToolSet } from 'ai'
import { z } from 'zod'

import { searchIssues } from '../linear/index.js'
import { logger } from '../logger.js'

const log = logger.child({ scope: 'tool:search-issues' })

export function makeSearchIssuesTool(linearKey: string): ToolSet[string] {
  return tool({
    description:
      'Search for issues in Linear by keyword or filter by state. Use this when the user asks about existing tasks.',
    inputSchema: z.object({
      query: z.string().describe('Search keyword or phrase'),
      state: z.string().optional().describe("Filter by workflow state name (e.g. 'In Progress', 'Todo', 'Done')"),
    }),
    execute: ({ query, state }) => {
      try {
        return searchIssues({ apiKey: linearKey, query, state })
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
