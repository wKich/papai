import { tool } from 'ai'
import type { ToolSet } from 'ai'
import { z } from 'zod'

import { logger } from '../logger.js'
import type { TaskProvider } from '../providers/types.js'

const log = logger.child({ scope: 'tool:list-tasks' })

export function makeListTasksTool(provider: TaskProvider): ToolSet[string] {
  return tool({
    description: 'List all tasks in a Kaneo project. Use this to see all tasks in a specific project.',
    inputSchema: z.object({
      projectId: z.string().describe('Kaneo project ID to list tasks from'),
    }),
    execute: async ({ projectId }) => {
      try {
        const tasks = await provider.listTasks(projectId)
        log.info({ projectId, taskCount: tasks.length }, 'Tasks listed via tool')
        return tasks
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
