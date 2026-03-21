import { tool } from 'ai'
import type { ToolSet } from 'ai'
import { z } from 'zod'

import { logger } from '../logger.js'
import { updateRecurringTask } from '../recurring.js'

const log = logger.child({ scope: 'tool:update-recurring-task' })

const inputSchema = z.object({
  recurringTaskId: z.string().describe('ID of the recurring task definition to update'),
  title: z.string().optional().describe('New title'),
  description: z.string().optional().describe('New description'),
  priority: z.enum(['no-priority', 'low', 'medium', 'high', 'urgent']).optional().describe('New priority'),
  status: z.string().optional().describe('New initial status'),
  assignee: z.string().optional().describe('New assignee'),
  labels: z.array(z.string()).optional().describe('New label IDs'),
  cronExpression: z.string().optional().describe('New cron expression (5-field)'),
  catchUp: z.boolean().optional().describe('Whether to create missed occurrences on resume'),
})

export function makeUpdateRecurringTaskTool(): ToolSet[string] {
  return tool({
    description:
      'Update a recurring task definition (title, description, priority, assignee, labels, schedule, catch-up setting).',
    inputSchema,
    execute: ({ recurringTaskId, title, description, priority, status, assignee, labels, cronExpression, catchUp }) => {
      try {
        log.debug({ recurringTaskId }, 'Updating recurring task')
        const updated = updateRecurringTask(recurringTaskId, {
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
          nextRun: updated.nextRun,
        }
      } catch (error) {
        log.error(
          {
            error: error instanceof Error ? error.message : String(error),
            recurringTaskId,
            tool: 'update_recurring_task',
          },
          'Tool execution failed',
        )
        throw error
      }
    },
  })
}
