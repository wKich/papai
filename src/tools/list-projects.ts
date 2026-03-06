import { tool } from 'ai'
import type { ToolSet } from 'ai'
import { z } from 'zod'

import { listProjects } from '../huly/index.js'
import { logger } from '../logger.js'

const log = logger.child({ scope: 'tool:list-projects' })

export function makeListProjectsTool(userId: number): ToolSet[string] {
  return tool({
    description:
      'List all available teams and projects. Call this to get projectId or teamId context before creating or searching issues.',
    inputSchema: z.object({}),
    execute: () => {
      try {
        return listProjects({ userId })
      } catch (error) {
        log.error(
          { error: error instanceof Error ? error.message : String(error), tool: 'list_projects' },
          'Tool execution failed',
        )
        throw error
      }
    },
  })
}
