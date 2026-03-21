import { tool } from 'ai'
import type { ToolSet } from 'ai'
import { z } from 'zod'

import { describeCron } from '../cron.js'
import { logger } from '../logger.js'
import { listRecurringTasks } from '../recurring.js'

const log = logger.child({ scope: 'tool:list-recurring-tasks' })

export function makeListRecurringTasksTool(userId: string): ToolSet[string] {
  return tool({
    description:
      'List all recurring task definitions for the current user, including schedule, status, and next run date.',
    inputSchema: z.object({}),
    execute: () => {
      try {
        log.debug({ userId }, 'Listing recurring tasks')
        const tasks = listRecurringTasks(userId)
        log.info({ userId, count: tasks.length }, 'Recurring tasks listed via tool')

        return tasks.map((t) => ({
          id: t.id,
          title: t.title,
          projectId: t.projectId,
          triggerType: t.triggerType,
          schedule:
            t.triggerType === 'cron' && t.cronExpression !== null ? describeCron(t.cronExpression) : 'after completion',
          cronExpression: t.cronExpression,
          enabled: t.enabled,
          nextRun: t.nextRun,
          lastRun: t.lastRun,
          priority: t.priority,
          assignee: t.assignee,
          labels: t.labels,
          catchUp: t.catchUp,
        }))
      } catch (error) {
        log.error(
          { error: error instanceof Error ? error.message : String(error), tool: 'list_recurring_tasks' },
          'Tool execution failed',
        )
        throw error
      }
    },
  })
}
