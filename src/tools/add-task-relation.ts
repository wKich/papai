import { tool } from 'ai'
import type { ToolSet } from 'ai'
import { z } from 'zod'

import { logger } from '../logger.js'
import type { TaskProvider } from '../providers/types.js'

const log = logger.child({ scope: 'tool:add-task-relation' })

export function makeAddTaskRelationTool(provider: TaskProvider): ToolSet[string] {
  return tool({
    description: 'Create a relation between two Kaneo tasks (stored as frontmatter in the task description).',
    inputSchema: z.object({
      taskId: z.string().describe('Kaneo task ID'),
      relatedTaskId: z.string().describe('Kaneo task ID of the related task'),
      type: z
        .enum(['blocks', 'duplicate', 'related', 'parent'])
        .describe(
          "'blocks': this task blocks the other; 'duplicate': marks as duplicate; 'related': general; 'parent': this task is a child of the related task",
        ),
    }),
    execute: async ({ taskId, relatedTaskId, type }) => {
      try {
        return await provider.addRelation!(taskId, relatedTaskId, type)
      } catch (error) {
        log.error(
          { error: error instanceof Error ? error.message : String(error), taskId, tool: 'add_task_relation' },
          'Tool execution failed',
        )
        throw error
      }
    },
  })
}
