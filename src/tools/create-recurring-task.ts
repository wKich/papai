import { tool } from 'ai'
import type { ToolSet } from 'ai'
import { z } from 'zod'

import { describeCron } from '../cron.js'
import { logger } from '../logger.js'
import { createRecurringTask } from '../recurring.js'
import type { TriggerType } from '../types/recurring.js'

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
  cronExpression: z
    .string()
    .optional()
    .describe("5-field cron (min hr dom mon dow). Required for 'cron'. E.g. '0 9 * * 1'"),
  catchUp: z.boolean().optional().describe('Create missed occurrences on resume. Default: false'),
})

type Input = z.infer<typeof inputSchema>

function executeCreate(userId: string, input: Input): unknown {
  log.debug({ userId, title: input.title, triggerType: input.triggerType }, 'Creating recurring task')

  if (input.triggerType === 'cron' && (input.cronExpression === undefined || input.cronExpression === '')) {
    return { error: "cronExpression is required when triggerType is 'cron'" }
  }

  const record = createRecurringTask({ userId, ...input, triggerType: input.triggerType satisfies TriggerType })

  const schedule =
    record.triggerType === 'cron' && record.cronExpression !== null
      ? describeCron(record.cronExpression)
      : 'after completion of current instance'

  log.info({ id: record.id, title: input.title, schedule }, 'Recurring task created via tool')

  return {
    id: record.id,
    title: record.title,
    projectId: record.projectId,
    triggerType: record.triggerType,
    schedule,
    nextRun: record.nextRun,
    enabled: record.enabled,
  }
}

export function makeCreateRecurringTaskTool(userId: string): ToolSet[string] {
  return tool({
    description:
      'Set up a recurring task that is automatically created on a schedule (cron) or after completion. Call list_projects first.',
    inputSchema,
    execute: (input) => {
      try {
        return executeCreate(userId, input)
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
