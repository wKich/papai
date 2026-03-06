import { tool } from 'ai'
import type { ToolSet } from 'ai'
import { z } from 'zod'

import { updateProject } from '../huly/index.js'
import { logger } from '../logger.js'

const log = logger.child({ scope: 'tool:update-project' })

export function makeUpdateProjectTool(userId: number): ToolSet[string] {
  return tool({
    description: 'Update an existing project.',
    inputSchema: z
      .object({
        projectId: z.string().describe('Project ID'),
        name: z.string().optional().describe('New project name'),
        description: z.string().optional().describe('New project description'),
      })
      .refine(
        (data) => data.name !== undefined || data.description !== undefined,
        'At least one of name or description must be provided',
      ),
    execute: async ({ projectId, name, description }) => {
      try {
        return await updateProject({ userId, projectId, name, description })
      } catch (error) {
        log.error(
          { error: error instanceof Error ? error.message : String(error), projectId, tool: 'update_project' },
          'Tool execution failed',
        )
        throw error
      }
    },
  })
}
