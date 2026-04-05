import { tool } from 'ai'
import type { ToolSet } from 'ai'
import { z } from 'zod'

import { describeCron } from '../cron.js'
import { logger } from '../logger.js'
import { listRecurringTasks as defaultListRecurringTasks } from '../recurring.js'
import type { RecurringTaskRecord } from '../types/recurring.js'
import { utcToLocal } from '../utils/datetime.js'

const log = logger.child({ scope: 'tool:list-recurring-tasks' })

export interface ListRecurringTasksDeps {
  listRecurringTasks: (userId: string) => RecurringTaskRecord[]
}

const defaultDeps: ListRecurringTasksDeps = {
  listRecurringTasks: (...args) => defaultListRecurringTasks(...args),
}

export function makeListRecurringTasksTool(
  userId: string,
  deps: ListRecurringTasksDeps = defaultDeps,
): ToolSet[string] {
  return tool({
    description:
      'List all recurring task definitions for the current user, including schedule, status, and next run date.',
    inputSchema: z.object({}),
    execute: () => {
      try {
        log.debug({ userId }, 'Listing recurring tasks')
        const tasks = deps.listRecurringTasks(userId)
        log.info({ userId, count: tasks.length }, 'Recurring tasks listed via tool')

        return tasks.map((t) => ({
          id: t.id,
          title: t.title,
          projectId: t.projectId,
          triggerType: t.triggerType,
          schedule:
            t.triggerType === 'cron' && t.cronExpression !== null
              ? describeCron(t.cronExpression, t.timezone)
              : 'after completion',
          cronExpression: t.cronExpression,
          enabled: t.enabled,
          nextRun: utcToLocal(t.nextRun, t.timezone),
          lastRun: utcToLocal(t.lastRun, t.timezone),
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
