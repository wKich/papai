import { tool } from 'ai'
import type { ToolSet } from 'ai'
import { z } from 'zod'

import type { KaneoConfig } from '../kaneo/client.js'
import { removeTaskLabel } from '../kaneo/index.js'
import { logger } from '../logger.js'

const log = logger.child({ scope: 'tool:remove-task-label' })

export function makeRemoveTaskLabelTool(kaneoConfig: KaneoConfig): ToolSet[string] {
  return tool({
    description: 'Remove a label from a Kaneo task.',
    inputSchema: z.object({
      taskId: z.string().describe('Kaneo task ID'),
      labelId: z.string().describe('Label ID to remove'),
    }),
    execute: async ({ taskId, labelId }) => {
      try {
        return await removeTaskLabel({ config: kaneoConfig, taskId, labelId })
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
