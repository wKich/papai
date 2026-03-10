import { tool } from 'ai'
import type { ToolSet } from 'ai'
import { z } from 'zod'

import type { KaneoConfig } from '../kaneo/client.js'
import { listLabels } from '../kaneo/index.js'
import { logger } from '../logger.js'

const log = logger.child({ scope: 'tool:list-labels' })

export function makeListLabelsTool(kaneoConfig: KaneoConfig, workspaceId: string): ToolSet[string] {
  return tool({
    description: 'List all available labels in the workspace. Use this to get label IDs before applying labels.',
    inputSchema: z.object({}),
    execute: async () => {
      try {
        return await listLabels({ config: kaneoConfig, workspaceId })
      } catch (error) {
        log.error(
          { error: error instanceof Error ? error.message : String(error), tool: 'list_labels' },
          'Tool execution failed',
        )
        throw error
      }
    },
  })
}
