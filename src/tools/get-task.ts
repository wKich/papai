import { tool } from 'ai'
import type { ToolSet } from 'ai'
import { z } from 'zod'

import { getConfig } from '../config.js'
import { logger } from '../logger.js'
import type { TaskProvider } from '../providers/types.js'
import { utcToLocal } from '../utils/datetime.js'

const log = logger.child({ scope: 'tool:get-task' })

const formatToolDueDate = (
  dueDate: string | null | undefined,
  timezone: string,
  provider: Readonly<TaskProvider>,
): string | null | undefined => {
  if (
    provider.name === 'youtrack' &&
    dueDate !== undefined &&
    dueDate !== null &&
    /^\d{4}-\d{2}-\d{2}$/.test(dueDate)
  ) {
    return dueDate
  }
  return utcToLocal(dueDate, timezone)
}

export function makeGetTaskTool(
  provider: Readonly<TaskProvider>,
  userId?: string,
  storageContextId?: string,
): ToolSet[string] {
  return tool({
    description:
      'Fetch complete details of a single task including description, status, priority, assignee, due date, and relations. For a full picture including comments, also call get_comments with the same task ID.',
    inputSchema: z.object({ taskId: z.string().describe('Task ID') }),
    execute: async ({ taskId }) => {
      try {
        const task = await provider.getTask(taskId)
        log.info({ taskId }, 'Task fetched via tool')
        // NI2 Fix: Use storageContextId for config lookup (per-user config stored there)
        // Falls back to userId for backwards compatibility, then UTC
        const configKey = storageContextId ?? userId
        const timezone = configKey === undefined ? 'UTC' : (getConfig(configKey, 'timezone') ?? 'UTC')
        return { ...task, dueDate: formatToolDueDate(task.dueDate, timezone, provider) }
      } catch (error) {
        log.error(
          { error: error instanceof Error ? error.message : String(error), taskId, tool: 'get_task' },
          'Tool execution failed',
        )
        throw error
      }
    },
  })
}
