import { tool } from 'ai'
import type { ToolSet } from 'ai'
import { z } from 'zod'

import { getConfig } from '../config.js'
import { describeCron } from '../cron.js'
import { logger } from '../logger.js'
import { createRecurringTask as defaultCreateRecurringTask } from '../recurring.js'
import type { RecurringTaskInput, RecurringTaskRecord, TriggerType } from '../types/recurring.js'
import { semanticScheduleToCron, utcToLocal } from '../utils/datetime.js'

export interface CreateRecurringTaskDeps {
  createRecurringTask: (input: RecurringTaskInput) => RecurringTaskRecord
}

const defaultDeps: CreateRecurringTaskDeps = {
  createRecurringTask: defaultCreateRecurringTask,
}

const log = logger.child({ scope: 'tool:create-recurring-task' })

const inputSchema = z.object({
  title: z.string().describe('Title for each generated task'),
  projectId: z.string().describe('Project ID — call list_projects first to obtain this'),
  description: z.string().optional().describe('Description for each generated task'),
  priority: z.enum(['no-priority', 'low', 'medium', 'high', 'urgent']).optional().describe('Priority level'),
  status: z.string().optional().describe("Initial status for each generated task (e.g. 'to-do')"),
  assignee: z.string().optional().describe('Assignee for each generated task'),
  labels: z.array(z.string()).optional().describe('Label IDs to apply to each generated task'),
  triggerType: z
    .enum(['cron', 'on_complete'])
    .describe("'cron' for fixed schedule, 'on_complete' for after-completion"),
  schedule: z
    .object({
      frequency: z.enum(['daily', 'weekly', 'monthly', 'weekdays', 'weekends']).describe('How often the task repeats'),
      time: z.string().describe("Time of day in HH:MM 24-hour format (user's local time)"),
      days_of_week: z
        .array(z.enum(['sun', 'mon', 'tue', 'wed', 'thu', 'fri', 'sat']))
        .optional()
        .describe('Which days for weekly frequency (e.g. ["mon", "wed", "fri"])'),
      day_of_month: z.number().int().min(1).max(31).optional().describe('Day of month for monthly frequency (1–31)'),
    })
    .optional()
    .describe("Schedule configuration for 'cron' triggerType"),
  catchUp: z.boolean().optional().describe('Create missed occurrences on resume. Default: false'),
})

type Input = z.infer<typeof inputSchema>

function executeCreate(userId: string, input: Input, deps: CreateRecurringTaskDeps): unknown {
  log.debug({ userId, title: input.title, triggerType: input.triggerType }, 'Creating recurring task')

  if (input.triggerType === 'cron' && input.schedule === undefined) {
    return { error: "schedule is required when triggerType is 'cron'" }
  }

  const timezone = getConfig(userId, 'timezone') ?? 'UTC'

  const cronExpression =
    input.triggerType === 'cron' && input.schedule !== undefined ? semanticScheduleToCron(input.schedule) : undefined

  const record = deps.createRecurringTask({
    userId,
    title: input.title,
    projectId: input.projectId,
    description: input.description,
    priority: input.priority,
    status: input.status,
    assignee: input.assignee,
    labels: input.labels,
    triggerType: input.triggerType satisfies TriggerType,
    cronExpression,
    catchUp: input.catchUp,
    timezone,
  })

  const schedule =
    record.triggerType === 'cron' && record.cronExpression !== null
      ? describeCron(record.cronExpression, record.timezone)
      : 'after completion of current instance'

  log.info({ id: record.id, title: input.title, schedule }, 'Recurring task created via tool')

  return {
    id: record.id,
    title: record.title,
    projectId: record.projectId,
    triggerType: record.triggerType,
    schedule,
    nextRun: utcToLocal(record.nextRun, record.timezone),
    enabled: record.enabled,
  }
}

export function makeCreateRecurringTaskTool(
  userId: string,
  deps: CreateRecurringTaskDeps = defaultDeps,
): ToolSet[string] {
  return tool({
    description:
      'Set up a recurring task that is automatically created on a schedule (cron) or after completion. Call list_projects first.',
    inputSchema,
    execute: (input) => {
      try {
        return executeCreate(userId, input, deps)
      } catch (error) {
        log.error(
          { error: error instanceof Error ? error.message : String(error), tool: 'create_recurring_task' },
          'Tool execution failed',
        )
        throw error
      }
    },
  })
}
