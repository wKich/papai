import { tool } from 'ai'
import type { ToolSet } from 'ai'
import { z } from 'zod'

import { logger } from '../logger.js'
import type { TaskProvider } from '../providers/types.js'

const log = logger.child({ scope: 'tool:get-task' })

export function makeGetTaskTool(provider: TaskProvider): ToolSet[string] {
  return tool({
    description: 'Fetch full details of a single Kaneo task including relations.',
    inputSchema: z.object({ taskId: z.string().describe('Kaneo task ID') }),
    execute: async ({ taskId }) => {
      try {
        const task = await provider.getTask(taskId)
        log.info({ taskId }, 'Task fetched via tool')
        return task
      } catch (error) {
        log.error(
          { error: error instanceof Error ? error.message : String(error), taskId, tool: 'get_task' },
          'Tool execution failed',
        )
        throw error
      }
    },
  })
}
