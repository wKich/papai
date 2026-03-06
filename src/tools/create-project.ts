import { tool } from 'ai'
import type { ToolSet } from 'ai'
import { z } from 'zod'

import { createProject } from '../linear/index.js'
import { logger } from '../logger.js'

const log = logger.child({ scope: 'tool:create-project' })

export function makeCreateProjectTool(userId: number): ToolSet[string] {
  return tool({
    description: 'Create a new project.',
    inputSchema: z.object({
      name: z.string().describe('Project name'),
      description: z.string().optional().describe('Project description'),
    }),
    execute: async ({ name, description }) => {
      try {
        return await createProject({ userId, name, description })
      } catch (error) {
        log.error(
          { error: error instanceof Error ? error.message : String(error), name, tool: 'create_project' },
          'Tool execution failed',
        )
        throw error
      }
    },
  })
}
