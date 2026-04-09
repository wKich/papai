import { tool } from 'ai'
import type { ToolSet } from 'ai'
import { z } from 'zod'

import { logger } from '../logger.js'
import type { TaskProvider } from '../providers/types.js'

const log = logger.child({ scope: 'tool:remove-project-member' })

export function makeRemoveProjectMemberTool(provider: TaskProvider): ToolSet[string] {
  return tool({
    description: 'Remove a user from a project team.',
    inputSchema: z.object({
      projectId: z.string().describe('Project ID to remove the user from'),
      userId: z.string().describe('User ID to remove from the project team'),
    }),
    execute: async ({ projectId, userId }) => {
      try {
        const result = await provider.removeProjectMember!(projectId, userId)
        log.info({ projectId, userId }, 'Project member removed via tool')
        return result
      } catch (error) {
        log.error(
          {
            error: error instanceof Error ? error.message : String(error),
            projectId,
            userId,
            tool: 'remove_project_member',
          },
          'Tool execution failed',
        )
        throw error
      }
    },
  })
}
