import { tool } from 'ai'
import type { ToolSet } from 'ai'
import { z } from 'zod'

import { rruleInputSchema } from '../deferred-prompts/types.js'
import { logger } from '../logger.js'
import { recurrenceSpecToRrule } from '../recurrence.js'
import {
  getRecurringTask as defaultGetRecurringTask,
  updateRecurringTask as defaultUpdateRecurringTask,
} from '../recurring.js'
import type { RecurringTaskRecord } from '../types/recurring.js'
import { utcToLocal } from '../utils/datetime.js'

const log = logger.child({ scope: 'tool:update-recurring-task' })

export interface UpdateRecurringTaskDeps {
  getRecurringTask: (id: string) => RecurringTaskRecord | null
  updateRecurringTask: (id: string, updates: Record<string, unknown>) => RecurringTaskRecord | null
}

const defaultDeps: UpdateRecurringTaskDeps = {
  getRecurringTask: (...args) => defaultGetRecurringTask(...args),
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
  schedule: rruleInputSchema
    .optional()
    .describe("Updated schedule. Call get_current_time first to obtain the user's IANA timezone."),
  catchUp: z.boolean().optional().describe('Whether to create missed occurrences on resume'),
})

type Input = z.infer<typeof inputSchema>

function executeUpdate(input: Input, deps: UpdateRecurringTaskDeps): unknown {
  const { recurringTaskId, title, description, priority, status, assignee, labels, schedule, catchUp } = input
  log.debug({ recurringTaskId }, 'Updating recurring task')

  const existing = deps.getRecurringTask(recurringTaskId)
  if (existing === null) {
    log.warn({ recurringTaskId }, 'Recurring task not found for update')
    return { error: 'Recurring task not found' }
  }

  const compiled =
    schedule === undefined
      ? undefined
      : recurrenceSpecToRrule({ ...schedule, dtstart: existing.dtstartUtc ?? new Date().toISOString() })

  const updated = deps.updateRecurringTask(recurringTaskId, {
    title,
    description,
    priority,
    status,
    assignee,
    labels,
    rrule: compiled?.rrule,
    dtstartUtc: compiled?.dtstartUtc,
    timezone: compiled?.timezone,
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

export function makeUpdateRecurringTaskTool(
  _userId: string,
  deps: UpdateRecurringTaskDeps = defaultDeps,
): ToolSet[string] {
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
