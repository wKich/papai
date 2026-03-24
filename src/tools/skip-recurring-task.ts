import { tool } from 'ai'
import type { ToolSet } from 'ai'
import { z } from 'zod'

import { logger } from '../logger.js'
import { skipNextOccurrence } from '../recurring.js'
import { utcToLocal } from '../utils/datetime.js'

const log = logger.child({ scope: 'tool:skip-recurring-task' })

export function makeSkipRecurringTaskTool(): ToolSet[string] {
  return tool({
    description:
      'Skip the next occurrence of a recurring task series. The series continues normally after the skipped occurrence.',
    inputSchema: z.object({
      recurringTaskId: z.string().describe('ID of the recurring task definition whose next occurrence to skip'),
    }),
    execute: ({ recurringTaskId }) => {
      try {
        log.debug({ recurringTaskId }, 'Skipping next recurring task occurrence')
        const result = skipNextOccurrence(recurringTaskId)

        if (result === null) {
          log.warn({ recurringTaskId }, 'Recurring task not found for skip')
          return { error: 'Recurring task not found' }
        }

        log.info({ id: result.id, title: result.title, nextRun: result.nextRun }, 'Next occurrence skipped via tool')
        return {
          id: result.id,
          title: result.title,
          nextRun: utcToLocal(result.nextRun, result.timezone),
          status: 'skipped — next occurrence updated',
        }
      } catch (error) {
        log.error(
          {
            error: error instanceof Error ? error.message : String(error),
            recurringTaskId,
            tool: 'skip_recurring_task',
          },
          'Tool execution failed',
        )
        throw error
      }
    },
  })
}
