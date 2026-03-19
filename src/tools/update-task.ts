import { tool } from 'ai'
import type { ToolSet } from 'ai'
import { z } from 'zod'

import { logger } from '../logger.js'
import type { TaskProvider } from '../providers/types.js'

const log = logger.child({ scope: 'tool:update-task' })

export function makeUpdateTaskTool(provider: TaskProvider): ToolSet[string] {
  return tool({
    description:
      "Update an existing Kaneo task's status, priority, assignee, due date, title, description, or project.",
    inputSchema: z.object({
      taskId: z.string().describe('The Kaneo task ID'),
      title: z.string().optional().describe('New task title'),
      description: z.string().optional().describe('New task description'),
      status: z
        .string()
        .optional()
        .describe("New status column slug (e.g. 'to-do', 'in-progress', 'in-review', 'done')"),
      priority: z.enum(['no-priority', 'low', 'medium', 'high', 'urgent']).optional().describe('New priority level'),
      dueDate: z.string().optional().describe("Due date in ISO 8601 format (e.g. '2026-03-15')"),
      userId: z.string().optional().describe('User ID to assign the task to'),
      projectId: z.string().optional().describe('Project ID to move the task to'),
    }),
    execute: async ({ taskId, title, description, status, priority, dueDate, userId, projectId }) => {
      try {
        const task = await provider.updateTask(taskId, {
          title,
          description,
          status,
          priority,
          dueDate,
          projectId,
          assignee: userId,
        })
        log.info({ taskId }, 'Task updated via tool')
        return task
      } catch (error) {
        log.error(
          { error: error instanceof Error ? error.message : String(error), taskId, tool: 'update_task' },
          'Tool execution failed',
        )
        throw error
      }
    },
  })
}
