import { tool } from 'ai'
import type { ToolSet } from 'ai'
import { z } from 'zod'

import { logger } from '../logger.js'
import type { TaskProvider } from '../providers/types.js'

const log = logger.child({ scope: 'tool:create-status' })

export function makeCreateStatusTool(provider: TaskProvider): ToolSet[string] {
  return tool({
    description: 'Create a new status in a project.',
    inputSchema: z.object({
      projectId: z.string().describe('Project ID'),
      name: z.string().describe('Status name (e.g., "In Progress", "Review", "Done")'),
      icon: z.string().optional().describe('Optional icon name for the status'),
      color: z.string().optional().describe('Optional hex color code (e.g., "#ff0000")'),
      isFinal: z.boolean().optional().describe('Whether this is a final/terminal status (default: false)'),
    }),
    execute: async ({ projectId, name, icon, color, isFinal }) => {
      try {
        return await provider.createStatus!(projectId, { name, icon, color, isFinal })
      } catch (error) {
        log.error(
          { error: error instanceof Error ? error.message : String(error), projectId, name, tool: 'create_status' },
          'Tool execution failed',
        )
        throw error
      }
    },
  })
}
