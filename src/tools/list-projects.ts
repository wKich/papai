import { tool } from 'ai'
import type { ToolSet } from 'ai'
import { z } from 'zod'

import { listProjects } from '../linear/index.js'
import { logger } from '../logger.js'

export function makeListProjectsTool(linearKey: string): ToolSet[string] {
  return tool({
    description:
      'List all available teams and projects in Linear. Call this to get projectId or teamId context before creating or searching issues.',
    inputSchema: z.object({}),
    execute: () => {
      try {
        return listProjects({ apiKey: linearKey })
      } catch (error) {
        logger.error(
          { error: error instanceof Error ? error.message : String(error), tool: 'list_projects' },
          'Tool execution failed',
        )
        throw error
      }
    },
  })
}
