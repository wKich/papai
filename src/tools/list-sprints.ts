import { tool } from 'ai'
import type { ToolSet } from 'ai'
import { z } from 'zod'

import { logger } from '../logger.js'
import type { TaskProvider } from '../providers/types.js'

const log = logger.child({ scope: 'tool:list-sprints' })

export function makeListSprintsTool(provider: Readonly<TaskProvider>): ToolSet[string] {
  return tool({
    description: 'List sprints for a specific agile board.',
    inputSchema: z.object({
      agileId: z.string().describe('Agile board ID'),
    }),
    execute: async ({ agileId }) => {
      try {
        const sprints = await provider.listSprints!(agileId)
        log.info({ agileId, count: sprints.length }, 'Sprints listed via tool')
        return sprints
      } catch (error) {
        log.error(
          { error: error instanceof Error ? error.message : String(error), agileId, tool: 'list_sprints' },
          'Tool execution failed',
        )
        throw error
      }
    },
  })
}
