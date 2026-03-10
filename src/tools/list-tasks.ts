import { tool } from 'ai'
import type { ToolSet } from 'ai'
import { z } from 'zod'

import type { KaneoConfig } from '../kaneo/client.js'
import { listTasks } from '../kaneo/index.js'
import { logger } from '../logger.js'

const log = logger.child({ scope: 'tool:list-tasks' })

export function makeListTasksTool(kaneoConfig: KaneoConfig): ToolSet[string] {
  return tool({
    description: 'List all tasks in a Kaneo project. Use this to see all tasks in a specific project.',
    inputSchema: z.object({
      projectId: z.string().describe('Kaneo project ID to list tasks from'),
    }),
    execute: async ({ projectId }) => {
      try {
        return await listTasks({ config: kaneoConfig, projectId })
      } catch (error) {
        log.error(
          { error: error instanceof Error ? error.message : String(error), projectId, tool: 'list_tasks' },
          'Tool execution failed',
        )
        throw error
      }
    },
  })
}
