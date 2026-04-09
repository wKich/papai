import { tool } from 'ai'
import type { ToolSet } from 'ai'
import { z } from 'zod'

import { logger } from '../logger.js'
import type { TaskProvider } from '../providers/types.js'

const log = logger.child({ scope: 'tool:remove-watcher' })

export function makeRemoveWatcherTool(provider: TaskProvider): ToolSet[string] {
  return tool({
    description: 'Remove a watcher from a task when they should no longer follow updates.',
    inputSchema: z.object({
      taskId: z.string().describe('Task ID that currently has the watcher'),
      userId: z.string().describe('User ID to remove from the watcher list'),
    }),
    execute: async ({ taskId, userId }) => {
      try {
        const result = await provider.removeWatcher!(taskId, userId)
        log.info({ taskId, userId }, 'Watcher removed via tool')
        return result
      } catch (error) {
        log.error(
          { error: error instanceof Error ? error.message : String(error), taskId, userId, tool: 'remove_watcher' },
          'Tool execution failed',
        )
        throw error
      }
    },
  })
}
