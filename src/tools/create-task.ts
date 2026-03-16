import { tool } from 'ai'
import type { ToolSet } from 'ai'
import { z } from 'zod'

import type { KaneoConfig } from '../kaneo/client.js'
import { createTask } from '../kaneo/index.js'
import { buildTaskUrl } from '../kaneo/url-builder.js'
import { logger } from '../logger.js'

const log = logger.child({ scope: 'tool:create-task' })

export interface CreateTaskResult {
  id: string
  title: string
  number: number | null
  status: string
  url: string
}

export function makeCreateTaskTool(kaneoConfig: KaneoConfig, workspaceId: string): ToolSet[string] {
  return tool({
    description: 'Create a new task in Kaneo. Call list_projects first to get a valid projectId.',
    inputSchema: z.object({
      title: z.string().describe('Short, descriptive task title'),
      description: z.string().optional().describe('Detailed description of the task'),
      priority: z.enum(['no-priority', 'low', 'medium', 'high', 'urgent']).optional().describe('Priority level'),
      projectId: z.string().describe('Kaneo project ID — call list_projects first to obtain this'),
      dueDate: z.string().optional().describe("Due date in ISO 8601 format (e.g. '2026-03-15')"),
      status: z.string().optional().describe("Status column slug (e.g. 'to-do', 'in-progress', 'done')"),
    }),
    execute: async ({ title, description, priority, projectId, dueDate, status }): Promise<CreateTaskResult> => {
      try {
        const task = await createTask({
          config: kaneoConfig,
          projectId,
          title,
          description,
          priority,
          status,
          dueDate,
        })
        const url = buildTaskUrl(kaneoConfig.baseUrl, workspaceId, projectId, task.id)
        log.info({ taskId: task.id, title, number: task.number }, 'Task created via tool')
        return { id: task.id, title: task.title, number: task.number, status: task.status, url }
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
