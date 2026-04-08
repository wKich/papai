import { tool } from 'ai'
import type { ToolSet } from 'ai'
import { z } from 'zod'

import { logger } from '../logger.js'
import type { TaskProvider } from '../providers/types.js'

const log = logger.child({ scope: 'tool:add-project-member' })

export function makeAddProjectMemberTool(provider: TaskProvider): ToolSet[string] {
  return tool({
    description: 'Add a user to a project team.',
    inputSchema: z.object({
      projectId: z.string().describe('Project ID to add the user to'),
      userId: z.string().describe('User ID to add to the project team'),
    }),
    execute: async ({ projectId, userId }) => {
      try {
        const result = await provider.addProjectMember!(projectId, userId)
        log.info({ projectId, userId }, 'Project member added via tool')
        return result
      } catch (error) {
        log.error(
          {
            error: error instanceof Error ? error.message : String(error),
            projectId,
            userId,
            tool: 'add_project_member',
          },
          'Tool execution failed',
        )
        throw error
      }
    },
  })
}
