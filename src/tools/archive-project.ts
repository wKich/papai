import { tool } from 'ai'
import type { ToolSet } from 'ai'
import { z } from 'zod'

import { archiveProject } from '../linear/index.js'
import { logger } from '../logger.js'

const log = logger.child({ scope: 'tool:archive-project' })

export function makeArchiveProjectTool(linearKey: string): ToolSet[string] {
  return tool({
    description: 'Archive a Linear project.',
    inputSchema: z.object({
      projectId: z.string().describe('Linear project ID'),
    }),
    execute: async ({ projectId }) => {
      try {
        return await archiveProject({ apiKey: linearKey, projectId })
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
