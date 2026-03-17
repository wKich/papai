import { tool } from 'ai'
import type { ToolSet } from 'ai'
import { z } from 'zod'

import { logger } from '../logger.js'
import type { TaskProvider } from '../providers/types.js'

const log = logger.child({ scope: 'tool:update-project' })

export function makeUpdateProjectTool(provider: TaskProvider): ToolSet[string] {
  return tool({
    description: 'Update an existing Kaneo project.',
    inputSchema: z
      .object({
        projectId: z.string().describe('Kaneo project ID'),
        name: z.string().optional().describe('New project name'),
        description: z.string().optional().describe('New project description'),
      })
      .refine(
        (data) => data.name !== undefined || data.description !== undefined,
        'At least one of name or description must be provided',
      ),
    execute: async ({ projectId, name, description }) => {
      try {
        const project = await provider.updateProject!(projectId, { name, description })
        log.info({ projectId, name: project.name }, 'Project updated via tool')
        return project
      } catch (error) {
        log.error(
          {
            error: error instanceof Error ? error.message : String(error),
            projectId,
            tool: 'update_project',
          },
          'Tool execution failed',
        )
        throw error
      }
    },
  })
}
