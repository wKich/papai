import { tool } from 'ai'
import type { ToolSet } from 'ai'
import { z } from 'zod'

import type { KaneoConfig } from '../kaneo/client.js'
import { archiveProject } from '../kaneo/index.js'
import { logger } from '../logger.js'

const log = logger.child({ scope: 'tool:archive-project' })

export function makeArchiveProjectTool(kaneoConfig: KaneoConfig): ToolSet[string] {
  return tool({
    description: 'Archive (delete) a Kaneo project.',
    inputSchema: z.object({
      projectId: z.string().describe('Kaneo project ID'),
    }),
    execute: async ({ projectId }) => {
      try {
        return await archiveProject({ config: kaneoConfig, projectId })
      } catch (error) {
        log.error(
          { error: error instanceof Error ? error.message : String(error), projectId, tool: 'archive_project' },
          'Tool execution failed',
        )
        throw error
      }
    },
  })
}
