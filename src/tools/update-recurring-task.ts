import { tool } from 'ai'
import type { ToolSet } from 'ai'
import { z } from 'zod'

import { logger } from '../logger.js'
import { updateRecurringTask as defaultUpdateRecurringTask } from '../recurring.js'
import type { RecurringTaskRecord } from '../types/recurring.js'
import { semanticScheduleToCron, utcToLocal } from '../utils/datetime.js'

const log = logger.child({ scope: 'tool:update-recurring-task' })

export interface UpdateRecurringTaskDeps {
  updateRecurringTask: (id: string, updates: Record<string, unknown>) => RecurringTaskRecord | null
}

const defaultDeps: UpdateRecurringTaskDeps = {
  updateRecurringTask: (...args) => defaultUpdateRecurringTask(...args),
}

const inputSchema = z.object({
  recurringTaskId: z.string().describe('ID of the recurring task definition to update'),
  title: z.string().optional().describe('New title'),
  description: z.string().optional().describe('New description'),
  priority: z.enum(['no-priority', 'low', 'medium', 'high', 'urgent']).optional().describe('New priority'),
  status: z.string().optional().describe('New initial status'),
  assignee: z.string().optional().describe('New assignee'),
  labels: z.array(z.string()).optional().describe('New label IDs'),
  schedule: z
    .object({
      frequency: z.enum(['daily', 'weekly', 'monthly', 'weekdays', 'weekends']).describe('How often the task repeats'),
      time: z.string().describe("Time of day in HH:MM 24-hour format (user's local time)"),
      days_of_week: z
        .array(z.enum(['sun', 'mon', 'tue', 'wed', 'thu', 'fri', 'sat']))
        .optional()
        .describe('Which days for weekly frequency'),
      day_of_month: z.number().int().min(1).max(31).optional().describe('Day of month for monthly frequency (1–31)'),
    })
    .optional()
    .describe('Updated schedule configuration'),
  catchUp: z.boolean().optional().describe('Whether to create missed occurrences on resume'),
})

type Input = z.infer<typeof inputSchema>

function executeUpdate(input: Input, deps: UpdateRecurringTaskDeps): unknown {
  const { recurringTaskId, title, description, priority, status, assignee, labels, schedule, catchUp } = input
  log.debug({ recurringTaskId }, 'Updating recurring task')

  const cronExpression = schedule === undefined ? undefined : semanticScheduleToCron(schedule)

  const updated = deps.updateRecurringTask(recurringTaskId, {
    title,
    description,
    priority,
    status,
    assignee,
    labels,
    cronExpression,
    catchUp,
  })

  if (updated === null) {
    log.warn({ recurringTaskId }, 'Recurring task not found for update')
    return { error: 'Recurring task not found' }
  }

  log.info({ id: updated.id, title: updated.title }, 'Recurring task updated via tool')
  return {
    id: updated.id,
    title: updated.title,
    projectId: updated.projectId,
    enabled: updated.enabled,
    nextRun: utcToLocal(updated.nextRun, updated.timezone),
  }
}

export function makeUpdateRecurringTaskTool(deps: UpdateRecurringTaskDeps = defaultDeps): ToolSet[string] {
  return tool({
    description:
      'Update a recurring task definition (title, description, priority, assignee, labels, schedule, catch-up setting).',
    inputSchema,
    execute: (input) => {
      try {
        return executeUpdate(input, deps)
      } catch (error) {
        log.error(
          {
            error: error instanceof Error ? error.message : String(error),
            recurringTaskId: input.recurringTaskId,
            tool: 'update_recurring_task',
          },
          'Tool execution failed',
        )
        throw error
      }
    },
  })
}
