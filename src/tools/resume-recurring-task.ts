import { tool } from 'ai'
import type { ToolSet } from 'ai'
import { z } from 'zod'

import { describeCron } from '../cron.js'
import { logger } from '../logger.js'
import { resumeRecurringTask } from '../recurring.js'
import { createMissedTasks } from '../scheduler.js'

const log = logger.child({ scope: 'tool:resume-recurring-task' })

const inputSchema = z.object({
  recurringTaskId: z.string().describe('ID of the recurring task definition to resume'),
  createMissed: z.boolean().optional().describe('If true, creates tasks for missed cycles. Default: false'),
})

type Input = z.infer<typeof inputSchema>

async function executeResume(input: Input): Promise<unknown> {
  const { recurringTaskId, createMissed } = input
  log.debug({ recurringTaskId, createMissed }, 'Resuming recurring task')
  const result = resumeRecurringTask(recurringTaskId, createMissed ?? false)

  if (result === null) {
    log.warn({ recurringTaskId }, 'Recurring task not found for resume')
    return { error: 'Recurring task not found' }
  }

  const { record, missedDates } = result
  const createdCount = missedDates.length > 0 ? await createMissedTasks(recurringTaskId, missedDates) : 0

  const schedule =
    record.triggerType === 'cron' && record.cronExpression !== null
      ? describeCron(record.cronExpression, record.timezone)
      : 'after completion'

  log.info(
    { id: record.id, title: record.title, createMissed, missedCreated: createdCount },
    'Recurring task resumed via tool',
  )
  return {
    id: record.id,
    title: record.title,
    enabled: record.enabled,
    nextRun: record.nextRun,
    schedule,
    status: 'active',
    missedTasksCreated: createdCount,
  }
}

export function makeResumeRecurringTaskTool(): ToolSet[string] {
  return tool({
    description: 'Resume a paused recurring task series. Optionally create missed occurrences retroactively.',
    inputSchema,
    execute: async (input) => {
      try {
        return await executeResume(input)
      } catch (error) {
        log.error(
          { error: error instanceof Error ? error.message : String(error), tool: 'resume_recurring_task' },
          'Tool execution failed',
        )
        throw error
      }
    },
  })
}
