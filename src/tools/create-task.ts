import { tool } from 'ai'
import type { ToolSet } from 'ai'
import { z } from 'zod'

import { logger } from '../logger.js'
import type { TaskProvider } from '../providers/types.js'

const log = logger.child({ scope: 'tool:create-task' })

export function makeCreateTaskTool(provider: TaskProvider): ToolSet[string] {
  return tool({
    description: 'Create a new task. Call list_projects first to get a valid projectId.',
    inputSchema: z.object({
      title: z.string().describe('Short, descriptive task title'),
      description: z.string().optional().describe('Detailed description of the task'),
      priority: z.enum(['no-priority', 'low', 'medium', 'high', 'urgent']).optional().describe('Priority level'),
      projectId: z.string().describe('Project ID — call list_projects first to obtain this'),
      dueDate: z
        .string()
        .optional()
        .describe("Due date in ISO 8601 format in the user's timezone (e.g. '2026-03-15' or '2026-03-15T17:00:00')"),
      status: z.string().optional().describe("Status column slug (e.g. 'to-do', 'in-progress', 'done')"),
    }),
    execute: async ({ title, description, priority, projectId, dueDate, status }) => {
      try {
        const task = await provider.createTask({ projectId, title, description, priority, status, dueDate })
        log.info({ taskId: task.id, title }, 'Task created via tool')
        return task
      } catch (error) {
        log.error(
          { error: error instanceof Error ? error.message : String(error), title, tool: 'create_task' },
          'Tool execution failed',
        )
        throw error
      }
    },
  })
}
