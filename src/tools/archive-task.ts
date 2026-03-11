import { tool } from 'ai'
import type { ToolSet } from 'ai'
import { z } from 'zod'

import type { KaneoConfig } from '../kaneo/client.js'
import { archiveTask } from '../kaneo/index.js'
import { logger } from '../logger.js'

const log = logger.child({ scope: 'tool:archive-task' })

export function makeArchiveTaskTool(kaneoConfig: KaneoConfig, workspaceId: string): ToolSet[string] {
  return tool({
    description: 'Archive a Kaneo task by adding the "archived" label. Use this when the user wants to archive a task.',
    inputSchema: z.object({
      taskId: z.string().describe('The Kaneo task ID to archive'),
    }),
    execute: async ({ taskId }) => {
      try {
        return await archiveTask({ config: kaneoConfig, taskId, workspaceId })
      } catch (error) {
        log.error(
          { error: error instanceof Error ? error.message : String(error), taskId, tool: 'archive_task' },
          'Tool execution failed',
        )
        throw error
      }
    },
  })
}
