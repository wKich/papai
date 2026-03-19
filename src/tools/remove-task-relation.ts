import { tool } from 'ai'
import type { ToolSet } from 'ai'
import { z } from 'zod'

import { logger } from '../logger.js'
import type { TaskProvider } from '../providers/types.js'

const log = logger.child({ scope: 'tool:remove-task-relation' })

export function makeRemoveTaskRelationTool(provider: TaskProvider): ToolSet[string] {
  return tool({
    description: 'Remove a relation between two Kaneo tasks.',
    inputSchema: z.object({
      taskId: z.string().describe('Kaneo task ID'),
      relatedTaskId: z.string().describe('Kaneo task ID of the related task'),
    }),
    execute: async ({ taskId, relatedTaskId }) => {
      try {
        return await provider.removeRelation!(taskId, relatedTaskId)
      } catch (error) {
        log.error(
          {
            error: error instanceof Error ? error.message : String(error),
            taskId,
            relatedTaskId,
            tool: 'remove_task_relation',
          },
          'Tool execution failed',
        )
        throw error
      }
    },
  })
}
