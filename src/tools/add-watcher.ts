import { tool } from 'ai'
import type { ToolSet } from 'ai'
import { z } from 'zod'

import { logger } from '../logger.js'
import type { TaskProvider } from '../providers/types.js'

const log = logger.child({ scope: 'tool:add-watcher' })

export function makeAddWatcherTool(provider: TaskProvider): ToolSet[string] {
  return tool({
    description: 'Add a watcher to a task so the specified user is notified about future updates.',
    inputSchema: z.object({
      taskId: z.string().describe('Task ID to watch'),
      userId: z.string().describe('User ID to add as a watcher'),
    }),
    execute: async ({ taskId, userId }) => {
      try {
        const result = await provider.addWatcher!(taskId, userId)
        log.info({ taskId, userId }, 'Watcher added via tool')
        return result
      } catch (error) {
        log.error(
          { error: error instanceof Error ? error.message : String(error), taskId, userId, tool: 'add_watcher' },
          'Tool execution failed',
        )
        throw error
      }
    },
  })
}
