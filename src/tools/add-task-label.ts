import { tool } from 'ai'
import type { ToolSet } from 'ai'
import { z } from 'zod'

import { logger } from '../logger.js'
import type { TaskProvider } from '../providers/types.js'

const log = logger.child({ scope: 'tool:add-task-label' })

export function makeAddTaskLabelTool(provider: TaskProvider): ToolSet[string] {
  return tool({
    description: 'Add a label to a task. Use list_labels first to get available label IDs.',
    inputSchema: z.object({
      taskId: z.string().describe('Task ID'),
      labelId: z.string().describe('Label ID to add'),
    }),
    execute: async ({ taskId, labelId }) => {
      try {
        return await provider.addTaskLabel!(taskId, labelId)
      } catch (error) {
        log.error(
          { error: error instanceof Error ? error.message : String(error), taskId, labelId, tool: 'add_task_label' },
          'Tool execution failed',
        )
        throw error
      }
    },
  })
}
