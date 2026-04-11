import { tool } from 'ai'
import type { ToolSet } from 'ai'
import { z } from 'zod'

import { resolveMeReference } from '../identity/resolver.js'
import { logger } from '../logger.js'
import type { TaskProvider } from '../providers/types.js'

const log = logger.child({ scope: 'tool:search-tasks' })

export function makeSearchTasksTool(provider: TaskProvider, userId?: string): ToolSet[string] {
  return tool({
    description: 'Search for tasks by keyword. Use this when the user asks about existing tasks.',
    inputSchema: z.object({
      query: z.string().describe('Search keyword or phrase'),
      projectId: z.string().optional().describe('Filter by project ID'),
      limit: z.number().optional().describe('Maximum number of results to return'),
    }),
    execute: async ({ query, projectId, limit }) => {
      try {
        let resolvedQuery = query

        // Resolve identity references in query
        if (userId !== undefined && /\b(my|me)\b/i.test(query)) {
          const identity = await resolveMeReference(userId, provider)
          if (identity.type === 'found') {
            // Replace "my" and "me" references with actual user login
            // Use a callback to preserve the original casing of surrounding text
            resolvedQuery = query.replace(/\bmy\b/gi, identity.identity.login)
            resolvedQuery = resolvedQuery.replace(/\bme\b/gi, identity.identity.login)
            log.debug({ userId, originalQuery: query, resolvedQuery }, 'Resolved identity in search query')
          }
        }

        const tasks = await provider.searchTasks({ query: resolvedQuery, projectId, limit })
        log.info({ query: resolvedQuery, resultCount: tasks.length }, 'Tasks searched via tool')
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
