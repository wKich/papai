import { logger } from '../logger.js'
import { classifyKaneoError } from './classify-error.js'
import { type KaneoConfig, kaneoFetch } from './client.js'

const log = logger.child({ scope: 'kaneo:create-project' })

interface KaneoProject {
  id: string
  name: string
  slug: string
}

export async function createProject({
  config,
  workspaceId,
  name,
  description,
}: {
  config: KaneoConfig
  workspaceId: string
  name: string
  description?: string
}): Promise<{ id: string; name: string; slug: string }> {
  log.debug({ workspaceId, name, hasDescription: description !== undefined }, 'createProject called')

  const slug = name
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '')

  try {
    const project = await kaneoFetch<KaneoProject>(config, 'POST', '/project', {
      name,
      workspaceId,
      icon: '',
      slug,
    })

    // Update description if provided (create doesn't support description)
    if (description !== undefined) {
      await kaneoFetch<KaneoProject>(config, 'PUT', `/project/${project.id}`, { description })
    }

    log.info({ workspaceId, projectId: project.id, name }, 'Project created')
    return { id: project.id, name: project.name, slug: project.slug }
  } catch (error) {
    log.error(
      { error: error instanceof Error ? error.message : String(error), workspaceId, name },
      'createProject failed',
    )
    throw classifyKaneoError(error)
  }
}
