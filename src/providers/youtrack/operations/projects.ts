import { logger } from '../../../logger.js'
import type { Project } from '../../types.js'
import { classifyYouTrackError } from '../classify-error.js'
import type { YouTrackConfig } from '../client.js'
import { youtrackFetch } from '../client.js'
import { PROJECT_FIELDS } from '../constants.js'
import { ProjectSchema } from '../schemas/project.js'

const log = logger.child({ scope: 'provider:youtrack:projects' })

export async function getYouTrackProject(config: YouTrackConfig, projectId: string): Promise<Project> {
  log.debug({ projectId }, 'getProject')
  try {
    const raw = await youtrackFetch(config, 'GET', `/api/admin/projects/${projectId}`, {
      query: { fields: PROJECT_FIELDS },
    })
    const project = ProjectSchema.parse(raw)
    log.info({ projectId: project.id, name: project.name }, 'Project retrieved')
    return {
      id: project.id,
      name: project.name,
      description: project.description,
      url: `${config.baseUrl}/projects/${project.shortName ?? project.id}`,
    }
  } catch (error) {
    log.error({ error: error instanceof Error ? error.message : String(error), projectId }, 'Failed to get project')
    throw classifyYouTrackError(error, { projectId })
  }
}

export async function listYouTrackProjects(config: YouTrackConfig): Promise<Project[]> {
  log.debug('listProjects')
  try {
    const raw = await youtrackFetch(config, 'GET', '/api/admin/projects', {
      query: { fields: PROJECT_FIELDS, $top: '100' },
    })
    const projects = ProjectSchema.array().parse(raw)
    log.info({ count: projects.length }, 'Projects listed')
    return projects
      .filter((p) => p.archived !== true)
      .map((p) => ({
        id: p.id,
        name: p.name,
        description: p.description,
        url: `${config.baseUrl}/projects/${p.shortName ?? p.id}`,
      }))
  } catch (error) {
    log.error({ error: error instanceof Error ? error.message : String(error) }, 'Failed to list projects')
    throw classifyYouTrackError(error)
  }
}

export async function createYouTrackProject(
  config: YouTrackConfig,
  params: { name: string; description?: string },
): Promise<Project> {
  log.debug({ name: params.name }, 'createProject')
  try {
    // Generate shortName from name (first 10 chars, uppercase, no spaces)
    const shortName = params.name
      .toUpperCase()
      .replace(/[^A-Z0-9]/g, '')
      .slice(0, 10)
    const body: Record<string, unknown> = {
      name: params.name,
      shortName,
    }
    if (params.description !== undefined) body['description'] = params.description
    const raw = await youtrackFetch(config, 'POST', '/api/admin/projects', {
      body,
      query: { fields: PROJECT_FIELDS },
    })
    const project = ProjectSchema.parse(raw)
    log.info({ projectId: project.id, name: project.name }, 'Project created')
    return {
      id: project.id,
      name: project.name,
      description: project.description,
      url: `${config.baseUrl}/projects/${project.shortName ?? project.id}`,
    }
  } catch (error) {
    log.error({ error: error instanceof Error ? error.message : String(error) }, 'Failed to create project')
    throw classifyYouTrackError(error)
  }
}

export async function updateYouTrackProject(
  config: YouTrackConfig,
  projectId: string,
  params: { name?: string; description?: string },
): Promise<Project> {
  log.debug({ projectId, hasName: params.name !== undefined }, 'updateProject')
  try {
    const body: Record<string, unknown> = {}
    if (params.name !== undefined) body['name'] = params.name
    if (params.description !== undefined) body['description'] = params.description
    const raw = await youtrackFetch(config, 'POST', `/api/admin/projects/${projectId}`, {
      body,
      query: { fields: PROJECT_FIELDS },
    })
    const project = ProjectSchema.parse(raw)
    log.info({ projectId: project.id }, 'Project updated')
    return {
      id: project.id,
      name: project.name,
      description: project.description,
      url: `${config.baseUrl}/projects/${project.shortName ?? project.id}`,
    }
  } catch (error) {
    log.error({ error: error instanceof Error ? error.message : String(error), projectId }, 'Failed to update project')
    throw classifyYouTrackError(error, { projectId })
  }
}

export async function deleteYouTrackProject(config: YouTrackConfig, projectId: string): Promise<{ id: string }> {
  log.debug({ projectId }, 'deleteProject')
  try {
    await youtrackFetch(config, 'DELETE', `/api/admin/projects/${projectId}`)
    log.info({ projectId }, 'Project deleted')
    return { id: projectId }
  } catch (error) {
    log.error({ error: error instanceof Error ? error.message : String(error), projectId }, 'Failed to delete project')
    throw classifyYouTrackError(error, { projectId })
  }
}
