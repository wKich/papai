import { tool } from 'ai'
import type { ToolSet } from 'ai'
import { z } from 'zod'

import type { KaneoConfig } from '../kaneo/client.js'
import { listProjects } from '../kaneo/index.js'
import { logger } from '../logger.js'

const log = logger.child({ scope: 'tool:list-projects' })

export function makeListProjectsTool(kaneoConfig: KaneoConfig, workspaceId: string): ToolSet[string] {
  return tool({
    description:
      'List all available projects in Kaneo. Call this to get project IDs before creating or searching tasks.',
    inputSchema: z.object({}),
    execute: () => {
      try {
        return listProjects({ config: kaneoConfig, workspaceId })
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
