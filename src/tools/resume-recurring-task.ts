import { tool } from 'ai'
import type { ToolSet } from 'ai'
import { z } from 'zod'

import { describeCron } from '../cron.js'
import { logger } from '../logger.js'
import { resumeRecurringTask } from '../recurring.js'

const log = logger.child({ scope: 'tool:resume-recurring-task' })

export function makeResumeRecurringTaskTool(): ToolSet[string] {
  return tool({
    description: 'Resume a paused recurring task series. Optionally create missed occurrences retroactively.',
    inputSchema: z.object({
      recurringTaskId: z.string().describe('ID of the recurring task definition to resume'),
      createMissed: z.boolean().optional().describe('If true, creates tasks for missed cycles. Default: false'),
    }),
    execute: ({ recurringTaskId, createMissed }) => {
      try {
        log.debug({ recurringTaskId, createMissed }, 'Resuming recurring task')
        const resumed = resumeRecurringTask(recurringTaskId, createMissed ?? false)

        if (resumed === null) {
          log.warn({ recurringTaskId }, 'Recurring task not found for resume')
          return { error: 'Recurring task not found' }
        }

        const schedule =
          resumed.triggerType === 'cron' && resumed.cronExpression !== null
            ? describeCron(resumed.cronExpression)
            : 'after completion'

        log.info({ id: resumed.id, title: resumed.title, createMissed }, 'Recurring task resumed via tool')
        return {
          id: resumed.id,
          title: resumed.title,
          enabled: resumed.enabled,
          nextRun: resumed.nextRun,
          schedule,
          status: 'active',
        }
      } catch (error) {
        log.error(
          {
            error: error instanceof Error ? error.message : String(error),
            recurringTaskId,
            tool: 'resume_recurring_task',
          },
          'Tool execution failed',
        )
        throw error
      }
    },
  })
}
