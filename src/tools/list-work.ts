import { tool } from 'ai'
import type { ToolSet } from 'ai'
import { z } from 'zod'

import { logger } from '../logger.js'
import type { TaskProvider } from '../providers/types.js'

const log = logger.child({ scope: 'tool:list-work' })

export function makeListWorkTool(provider: TaskProvider): ToolSet[string] {
  return tool({
    description: 'List all work items (time tracking entries) logged on a task.',
    inputSchema: z.object({
      taskId: z.string().describe('Task ID to list work items for'),
    }),
    execute: async ({ taskId }) => {
      log.debug({ taskId }, 'list_work called')
      try {
        const result = await provider.listWorkItems!(taskId)
        log.info({ taskId, count: result.length }, 'Work items listed')
        return result
      } catch (error) {
        log.error(
          { error: error instanceof Error ? error.message : String(error), taskId, tool: 'list_work' },
          'Tool execution failed',
        )
        throw error
      }
    },
  })
}
