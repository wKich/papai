import { tool } from 'ai'
import type { ToolSet } from 'ai'
import { z } from 'zod'

import { getConfig } from '../config.js'
import { logger } from '../logger.js'
import type { TaskProvider } from '../providers/types.js'
import { utcToLocal } from '../utils/datetime.js'

const log = logger.child({ scope: 'tool:list-tasks' })

export function makeListTasksTool(provider: TaskProvider, userId?: string): ToolSet[string] {
  return tool({
    description: 'List all tasks in a project. Use this to see all tasks in a specific project.',
    inputSchema: z.object({
      projectId: z.string().describe('Project ID to list tasks from'),
    }),
    execute: async ({ projectId }) => {
      try {
        const tasks = await provider.listTasks(projectId)
        log.info({ projectId, taskCount: tasks.length }, 'Tasks listed via tool')
        const timezone = userId === undefined ? 'UTC' : (getConfig(userId, 'timezone') ?? 'UTC')
        return tasks.map((task) => ({ ...task, dueDate: utcToLocal(task.dueDate, timezone) }))
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
