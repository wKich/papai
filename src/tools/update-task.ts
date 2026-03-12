import { tool } from 'ai'
import type { ToolSet } from 'ai'
import { z } from 'zod'

import type { KaneoConfig } from '../kaneo/client.js'
import { updateTask } from '../kaneo/index.js'
import { buildTaskUrl } from '../kaneo/url-builder.js'
import { logger } from '../logger.js'

const log = logger.child({ scope: 'tool:update-task' })

export function makeUpdateTaskTool(kaneoConfig: KaneoConfig, workspaceId: string): ToolSet[string] {
  return tool({
    description:
      "Update an existing Kaneo task's status, priority, assignee, due date, title, description, or project.",
    inputSchema: z.object({
      taskId: z.string().describe('The Kaneo task ID'),
      title: z.string().optional().describe('New task title'),
      description: z.string().optional().describe('New task description'),
      status: z.string().optional().describe("New status column name (e.g. 'in-progress', 'done')"),
      priority: z.enum(['no-priority', 'low', 'medium', 'high', 'urgent']).optional().describe('New priority level'),
      dueDate: z.string().optional().describe("Due date in ISO 8601 format (e.g. '2026-03-15')"),
      userId: z.string().optional().describe('User ID to assign the task to'),
      projectId: z.string().optional().describe('Project ID to move the task to'),
    }),
    execute: async ({ taskId, title, description, status, priority, dueDate, userId, projectId }) => {
      try {
        const task = await updateTask({
          config: kaneoConfig,
          taskId,
          title,
          description,
          status,
          priority,
          dueDate,
          userId,
          projectId,
        })
        const resolvedProjectId = task.projectId
        const url =
          resolvedProjectId === undefined
            ? undefined
            : buildTaskUrl(kaneoConfig.baseUrl, workspaceId, resolvedProjectId, task.id)
        log.info({ taskId, number: task.number }, 'Task updated via tool')
        return { id: task.id, title: task.title, number: task.number, status: task.status, url }
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
