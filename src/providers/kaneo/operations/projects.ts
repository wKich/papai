import type { Project } from '../../types.js'
import { createProject, deleteProject, listProjects, updateProject } from '../api.js'
import type { KaneoConfig } from '../client.js'
import { mapProject } from '../mappers.js'
import { buildProjectUrl } from '../url-builder.js'

export async function kaneoListProjects(config: KaneoConfig, workspaceId: string): Promise<Project[]> {
  const results = await listProjects({ config, workspaceId })
  return results.map((p) => mapProject(p, buildProjectUrl(config.baseUrl, workspaceId, p.id)))
}

export async function kaneoCreateProject(
  config: KaneoConfig,
  workspaceId: string,
  params: { name: string; description?: string },
): Promise<Project> {
  const result = await createProject({ config, workspaceId, name: params.name, description: params.description })
  return mapProject(result, buildProjectUrl(config.baseUrl, workspaceId, result.id))
}

export async function kaneoUpdateProject(
  config: KaneoConfig,
  workspaceId: string,
  projectId: string,
  params: { name?: string; description?: string },
): Promise<Project> {
  const result = await updateProject({
    config,
    workspaceId,
    projectId,
    name: params.name,
    description: params.description,
  })
  return mapProject(result, buildProjectUrl(config.baseUrl, workspaceId, result.id))
}

export async function kaneoArchiveProject(config: KaneoConfig, projectId: string): Promise<{ id: string }> {
  const result = await deleteProject({ config, projectId })
  return { id: result.id }
}
