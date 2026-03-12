import { tool } from 'ai'
import type { ToolSet } from 'ai'
import { z } from 'zod'

import type { KaneoConfig } from '../kaneo/client.js'
import { getTask } from '../kaneo/index.js'
import { buildTaskUrl } from '../kaneo/url-builder.js'
import { logger } from '../logger.js'

const log = logger.child({ scope: 'tool:get-task' })

export function makeGetTaskTool(kaneoConfig: KaneoConfig, workspaceId: string): ToolSet[string] {
  return tool({
    description: 'Fetch full details of a single Kaneo task including relations.',
    inputSchema: z.object({ taskId: z.string().describe('Kaneo task ID') }),
    execute: async ({ taskId }) => {
      try {
        const task = await getTask({ config: kaneoConfig, taskId })
        const url = buildTaskUrl(kaneoConfig.baseUrl, workspaceId, task.projectId, taskId)
        log.info({ taskId, number: task.number }, 'Task fetched via tool')
        return { ...task, url }
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
