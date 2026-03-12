import { tool } from 'ai'
import type { ToolSet } from 'ai'
import { z } from 'zod'

import type { KaneoConfig } from '../kaneo/client.js'
import { updateProject } from '../kaneo/index.js'
import { buildProjectUrl } from '../kaneo/url-builder.js'
import { logger } from '../logger.js'

const log = logger.child({ scope: 'tool:update-project' })

export function makeUpdateProjectTool(kaneoConfig: KaneoConfig, workspaceId: string): ToolSet[string] {
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
        const project = await updateProject({ config: kaneoConfig, workspaceId, projectId, name, description })
        const url = buildProjectUrl(kaneoConfig.baseUrl, workspaceId, project.id)
        log.info({ projectId, name: project.name }, 'Project updated via tool')
        return { ...project, url }
      } catch (error) {
        log.error(
          {
            error: error instanceof Error ? error.message : String(error),
            projectId,
            workspaceId,
            tool: 'update_project',
          },
          'Tool execution failed',
        )
        throw error
      }
    },
  })
}
