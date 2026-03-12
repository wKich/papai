import { tool } from 'ai'
import type { ToolSet } from 'ai'
import { z } from 'zod'

import type { KaneoConfig } from '../kaneo/client.js'
import { searchTasks } from '../kaneo/index.js'
import { buildTaskUrl } from '../kaneo/url-builder.js'
import { logger } from '../logger.js'

const log = logger.child({ scope: 'tool:search-tasks' })

export function makeSearchTasksTool(kaneoConfig: KaneoConfig, workspaceId: string): ToolSet[string] {
  return tool({
    description: 'Search for tasks in Kaneo by keyword. Use this when the user asks about existing tasks.',
    inputSchema: z.object({
      query: z.string().describe('Search keyword or phrase'),
      projectId: z.string().optional().describe('Filter by project ID'),
      limit: z.number().optional().describe('Maximum number of results to return'),
    }),
    execute: async ({ query, projectId, limit }) => {
      try {
        const tasks = await searchTasks({ config: kaneoConfig, query, workspaceId, projectId, limit })
        log.info({ query, resultCount: tasks.length }, 'Tasks searched via tool')
        return tasks.map((task) => ({
          ...task,
          url:
            task.projectId === undefined
              ? undefined
              : buildTaskUrl(kaneoConfig.baseUrl, workspaceId, task.projectId, task.id),
        }))
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
