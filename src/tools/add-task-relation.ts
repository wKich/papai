import { tool } from 'ai'
import type { ToolSet } from 'ai'
import { z } from 'zod'

import type { KaneoConfig } from '../kaneo/client.js'
import { addTaskRelation } from '../kaneo/index.js'
import { logger } from '../logger.js'

const log = logger.child({ scope: 'tool:add-task-relation' })

export function makeAddTaskRelationTool(kaneoConfig: KaneoConfig): ToolSet[string] {
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
        return await addTaskRelation({ config: kaneoConfig, taskId, relatedTaskId, type })
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
