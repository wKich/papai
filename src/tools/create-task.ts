import { tool } from 'ai'
import type { ToolSet } from 'ai'
import { z } from 'zod'

import { getConfig } from '../config.js'
import { logger } from '../logger.js'
import type { TaskProvider } from '../providers/types.js'
import { localDatetimeToUtc, utcToLocal } from '../utils/datetime.js'

const log = logger.child({ scope: 'tool:create-task' })

export function makeCreateTaskTool(provider: TaskProvider, userId?: string): ToolSet[string] {
  return tool({
    description: 'Create a new task. Call list_projects first to get a valid projectId.',
    inputSchema: z.object({
      title: z.string().describe('Short, descriptive task title'),
      description: z.string().optional().describe('Detailed description of the task'),
      priority: z.enum(['no-priority', 'low', 'medium', 'high', 'urgent']).optional().describe('Priority level'),
      projectId: z.string().describe('Project ID — call list_projects first to obtain this'),
      dueDate: z
        .object({
          date: z.string().describe("Date in YYYY-MM-DD format (user's local date)"),
          time: z.string().optional().describe("Time in HH:MM 24-hour format (user's local time)"),
        })
        .optional()
        .describe("Due date in the user's local time — tool converts to UTC"),
      status: z.string().optional().describe("Status column slug (e.g. 'to-do', 'in-progress', 'done')"),
    }),
    execute: async ({ title, description, priority, projectId, dueDate, status }) => {
      try {
        const timezone = userId === undefined ? 'UTC' : (getConfig(userId, 'timezone') ?? 'UTC')
        const resolvedDueDate =
          dueDate === undefined ? undefined : localDatetimeToUtc(dueDate.date, dueDate.time, timezone)

        const task = await provider.createTask({
          projectId,
          title,
          description,
          priority,
          status,
          dueDate: resolvedDueDate,
        })
        log.info({ taskId: task.id, title }, 'Task created via tool')
        return { ...task, dueDate: utcToLocal(task.dueDate, timezone) }
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
