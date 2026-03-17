import { tool } from 'ai'
import type { ToolSet } from 'ai'
import { z } from 'zod'

import { logger } from '../logger.js'
import type { TaskProvider } from '../providers/types.js'

const log = logger.child({ scope: 'tool:search-tasks' })

export function makeSearchTasksTool(provider: TaskProvider): ToolSet[string] {
  return tool({
    description: 'Search for tasks in Kaneo by keyword. Use this when the user asks about existing tasks.',
    inputSchema: z.object({
      query: z.string().describe('Search keyword or phrase'),
      projectId: z.string().optional().describe('Filter by project ID'),
      limit: z.number().optional().describe('Maximum number of results to return'),
    }),
    execute: async ({ query, projectId, limit }) => {
      try {
        const tasks = await provider.searchTasks({ query, projectId, limit })
        log.info({ query, resultCount: tasks.length }, 'Tasks searched via tool')
        return tasks
      } catch (error) {
        log.error(
          { error: error instanceof Error ? error.message : String(error), query, tool: 'search_tasks' },
          'Tool execution failed',
        )
        throw error
      }
    },
  })
}
