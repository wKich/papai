import { tool } from 'ai'
import type { ToolSet } from 'ai'
import { z } from 'zod'

import type { KaneoConfig } from '../kaneo/client.js'
import { getTask } from '../kaneo/index.js'
import { logger } from '../logger.js'

const log = logger.child({ scope: 'tool:get-task' })

export function makeGetTaskTool(kaneoConfig: KaneoConfig): ToolSet[string] {
  return tool({
    description: 'Fetch full details of a single Kaneo task including relations.',
    inputSchema: z.object({ taskId: z.string().describe('Kaneo task ID') }),
    execute: async ({ taskId }) => {
      try {
        return await getTask({ config: kaneoConfig, taskId })
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
