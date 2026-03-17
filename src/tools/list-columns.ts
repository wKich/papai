import { tool } from 'ai'
import type { ToolSet } from 'ai'
import { z } from 'zod'

import { logger } from '../logger.js'
import type { TaskProvider } from '../providers/types.js'

const log = logger.child({ scope: 'tool:list-columns' })

export function makeListColumnsTool(provider: TaskProvider): ToolSet[string] {
  return tool({
    description:
      'List all status columns in a Kaneo project. Use this to see available statuses before updating a task status.',
    inputSchema: z.object({
      projectId: z.string().describe('Kaneo project ID'),
    }),
    execute: async ({ projectId }) => {
      try {
        return await provider.listColumns!(projectId)
      } catch (error) {
        log.error(
          { error: error instanceof Error ? error.message : String(error), projectId, tool: 'list_columns' },
          'Tool execution failed',
        )
        throw error
      }
    },
  })
}
