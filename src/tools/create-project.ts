import { tool } from 'ai'
import type { ToolSet } from 'ai'
import { z } from 'zod'

import type { KaneoConfig } from '../kaneo/client.js'
import { createProject } from '../kaneo/index.js'
import { buildProjectUrl } from '../kaneo/url-builder.js'
import { logger } from '../logger.js'

const log = logger.child({ scope: 'tool:create-project' })

export function makeCreateProjectTool(kaneoConfig: KaneoConfig, workspaceId: string): ToolSet[string] {
  return tool({
    description: 'Create a new project in Kaneo.',
    inputSchema: z.object({
      name: z.string().describe('Project name'),
      description: z.string().optional().describe('Project description'),
    }),
    execute: async ({ name, description }) => {
      try {
        const project = await createProject({ config: kaneoConfig, workspaceId, name, description })
        const url = buildProjectUrl(kaneoConfig.baseUrl, workspaceId, project.id)
        log.info({ projectId: project.id, name }, 'Project created via tool')
        return { ...project, url }
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
