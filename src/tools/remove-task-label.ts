import { tool } from 'ai'
import type { ToolSet } from 'ai'
import { z } from 'zod'

import { logger } from '../logger.js'
import type { TaskProvider } from '../providers/types.js'

const log = logger.child({ scope: 'tool:remove-task-label' })

export function makeRemoveTaskLabelTool(provider: TaskProvider): ToolSet[string] {
  return tool({
    description: 'Remove a label from a task.',
    inputSchema: z.object({
      taskId: z.string().describe('Task ID'),
      labelId: z.string().describe('Label ID to remove'),
    }),
    execute: async ({ taskId, labelId }) => {
      try {
        return await provider.removeTaskLabel!(taskId, labelId)
      } catch (error) {
        log.error(
          {
            error: error instanceof Error ? error.message : String(error),
            taskId,
            labelId,
            tool: 'remove_task_label',
          },
          'Tool execution failed',
        )
        throw error
      }
    },
  })
}
