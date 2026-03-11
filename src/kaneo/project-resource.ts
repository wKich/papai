import { z } from 'zod'

import { logger } from '../logger.js'
import { classifyKaneoError } from './classify-error.js'
import { type KaneoConfig, KaneoProjectSchema, kaneoFetch } from './client.js'

function generateSlug(name: string): string {
  return name
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '')
}

export class ProjectResource {
  private log = logger.child({ scope: 'kaneo:project-resource' })

  constructor(private config: KaneoConfig) {}

  async create(params: {
    workspaceId: string
    name: string
    description?: string
  }): Promise<z.infer<typeof KaneoProjectSchema>> {
    this.log.debug({ workspaceId: params.workspaceId, name: params.name }, 'Creating project')

    try {
      const project = await kaneoFetch(
        this.config,
        'POST',
        '/project',
        {
          name: params.name,
          workspaceId: params.workspaceId,
          icon: '',
          slug: generateSlug(params.name),
        },
        undefined,
        KaneoProjectSchema,
      )

      if (params.description !== undefined) {
        await kaneoFetch(
          this.config,
          'PUT',
          `/project/${project.id}`,
          { description: params.description },
          undefined,
          KaneoProjectSchema,
        )
      }

      this.log.info({ projectId: project.id, name: project.name }, 'Project created')
      return project
    } catch (error) {
      this.log.error({ error: error instanceof Error ? error.message : String(error) }, 'Failed to create project')
      throw classifyKaneoError(error)
    }
  }

  async list(workspaceId: string): Promise<z.infer<typeof KaneoProjectSchema>[]> {
    this.log.debug({ workspaceId }, 'Listing projects')

    try {
      const projects = await kaneoFetch(
        this.config,
        'GET',
        '/project',
        undefined,
        { workspaceId },
        z.array(KaneoProjectSchema),
      )
      this.log.info({ count: projects.length }, 'Projects listed')
      return projects
    } catch (error) {
      this.log.error({ error: error instanceof Error ? error.message : String(error) }, 'Failed to list projects')
      throw classifyKaneoError(error)
    }
  }

  async update(
    projectId: string,
    params: { name?: string; description?: string },
  ): Promise<z.infer<typeof KaneoProjectSchema>> {
    this.log.debug({ projectId, ...params }, 'Updating project')

    try {
      const body: Record<string, string> = {}
      if (params.name !== undefined) body['name'] = params.name
      if (params.description !== undefined) body['description'] = params.description

      const project = await kaneoFetch(this.config, 'PUT', `/project/${projectId}`, body, undefined, KaneoProjectSchema)
      this.log.info({ projectId, name: project.name }, 'Project updated')
      return project
    } catch (error) {
      this.log.error({ error: error instanceof Error ? error.message : String(error) }, 'Failed to update project')
      throw classifyKaneoError(error)
    }
  }

  async archive(projectId: string): Promise<{ id: string; success: true }> {
    this.log.debug({ projectId }, 'Archiving project')

    try {
      await kaneoFetch(this.config, 'DELETE', `/project/${projectId}`, undefined, undefined, z.unknown())
      this.log.info({ projectId }, 'Project archived')
      return { id: projectId, success: true }
    } catch (error) {
      this.log.error({ error: error instanceof Error ? error.message : String(error) }, 'Failed to archive project')
      throw classifyKaneoError(error)
    }
  }
}
