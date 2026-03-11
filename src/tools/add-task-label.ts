import { tool } from 'ai'
import type { ToolSet } from 'ai'
import { z } from 'zod'

import type { KaneoConfig } from '../kaneo/client.js'
import { addTaskLabel } from '../kaneo/index.js'
import { logger } from '../logger.js'

const log = logger.child({ scope: 'tool:add-task-label' })

export function makeAddTaskLabelTool(kaneoConfig: KaneoConfig, workspaceId: string): ToolSet[string] {
  return tool({
    description: 'Add a label to a Kaneo task. Use list_labels first to get available label IDs.',
    inputSchema: z.object({
      taskId: z.string().describe('Kaneo task ID'),
      labelId: z.string().describe('Label ID to add'),
    }),
    execute: async ({ taskId, labelId }) => {
      try {
        return await addTaskLabel({ config: kaneoConfig, taskId, labelId, workspaceId })
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
