import { tool } from 'ai'
import type { ToolSet } from 'ai'
import { z } from 'zod'

import { logger } from '../logger.js'
import type { TaskProvider } from '../providers/types.js'

const log = logger.child({ scope: 'tool:list-project-team' })

export function makeListProjectTeamTool(provider: TaskProvider): ToolSet[string] {
  return tool({
    description: 'List the team assigned to a project so you can inspect current project membership.',
    inputSchema: z.object({
      projectId: z.string().describe('Project ID whose team members should be listed'),
    }),
    execute: async ({ projectId }) => {
      try {
        const users = await provider.listProjectTeam!(projectId)
        log.info({ projectId, count: users.length }, 'Project team listed via tool')
        return users
      } catch (error) {
        log.error(
          { error: error instanceof Error ? error.message : String(error), projectId, tool: 'list_project_team' },
          'Tool execution failed',
        )
        throw error
      }
    },
  })
}
