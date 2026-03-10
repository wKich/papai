import { tool } from 'ai'
import type { ToolSet } from 'ai'
import { z } from 'zod'

import type { KaneoConfig } from '../kaneo/client.js'
import { createTask } from '../kaneo/index.js'
import { logger } from '../logger.js'

const log = logger.child({ scope: 'tool:create-task' })

export function makeCreateTaskTool(kaneoConfig: KaneoConfig, defaultProjectId: string): ToolSet[string] {
  return tool({
    description: 'Create a new task in Kaneo. Use this when the user wants to add a task or bug report.',
    inputSchema: z.object({
      title: z.string().describe('Short, descriptive task title'),
      description: z.string().optional().describe('Detailed description of the task'),
      priority: z.enum(['no-priority', 'low', 'medium', 'high', 'urgent']).optional().describe('Priority level'),
      projectId: z.string().optional().describe('Kaneo project ID (uses default project if not provided)'),
      dueDate: z.string().optional().describe("Due date in ISO 8601 format (e.g. '2026-03-15')"),
      status: z.string().optional().describe("Status column name (e.g. 'todo', 'in-progress')"),
    }),
    execute: async ({ title, description, priority, projectId, dueDate, status }) => {
      try {
        const task = await createTask({
          config: kaneoConfig,
          projectId: projectId ?? defaultProjectId,
          title,
          description,
          priority,
          status,
          dueDate,
        })
        log.info({ taskId: task.id, title, number: task.number }, 'Task created via tool')
        return { id: task.id, title: task.title, number: task.number, status: task.status }
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
