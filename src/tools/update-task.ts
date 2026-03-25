import { tool } from 'ai'
import type { ToolSet } from 'ai'
import { z } from 'zod'

import { getConfig } from '../config.js'
import { logger } from '../logger.js'
import type { TaskProvider } from '../providers/types.js'
import { localDatetimeToUtc, utcToLocal } from '../utils/datetime.js'
import type { CompletionHookFn } from './completion-hook.js'

const log = logger.child({ scope: 'tool:update-task' })

const inputSchema = z.object({
  taskId: z.string().describe('The task ID'),
  title: z.string().optional().describe('New task title'),
  description: z.string().optional().describe('New task description'),
  status: z.string().optional().describe("New status column slug (e.g. 'to-do', 'in-progress', 'in-review', 'done')"),
  priority: z.enum(['no-priority', 'low', 'medium', 'high', 'urgent']).optional().describe('New priority level'),
  dueDate: z
    .object({
      date: z.string().describe("Date in YYYY-MM-DD format (user's local date)"),
      time: z.string().optional().describe("Time in HH:MM 24-hour format (user's local time)"),
    })
    .optional()
    .describe("Due date in the user's local time — tool converts to UTC"),
  assignee: z.string().optional().describe('User ID to assign the task to'),
  projectId: z.string().optional().describe('Project ID to move the task to'),
})

export function makeUpdateTaskTool(
  provider: TaskProvider,
  completionHook?: CompletionHookFn,
  userId?: string,
): ToolSet[string] {
  return tool({
    description: "Update an existing task's status, priority, assignee, due date, title, description, or project.",
    inputSchema,
    execute: async ({ taskId, title, description, status, priority, dueDate, assignee, projectId }) => {
      try {
        const timezone = userId === undefined ? 'UTC' : (getConfig(userId, 'timezone') ?? 'UTC')
        const resolvedDueDate =
          dueDate === undefined ? undefined : localDatetimeToUtc(dueDate.date, dueDate.time, timezone)

        const task = await provider.updateTask(taskId, {
          title,
          description,
          status,
          priority,
          dueDate: resolvedDueDate,
          projectId,
          assignee,
        })
        log.info({ taskId }, 'Task updated via tool')

        if (completionHook !== undefined && task.status !== undefined) {
          await completionHook(taskId, task.status, provider)
        }

        return { ...task, dueDate: utcToLocal(task.dueDate, timezone) }
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
