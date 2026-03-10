import { logger } from '../logger.js'
import { classifyKaneoError } from './classify-error.js'
import { type KaneoConfig, kaneoFetch } from './client.js'

const log = logger.child({ scope: 'kaneo:list-projects' })

interface KaneoProject {
  id: string
  name: string
  slug: string
  icon: string
  description: string | null
}

export async function listProjects({
  config,
  workspaceId,
}: {
  config: KaneoConfig
  workspaceId: string
}): Promise<{ id: string; name: string; slug: string }[]> {
  log.debug({ workspaceId }, 'listProjects called')

  try {
    const projects = await kaneoFetch<KaneoProject[]>(config, 'GET', '/project', undefined, { workspaceId })
    const result = projects.map((p) => ({ id: p.id, name: p.name, slug: p.slug }))
    log.info({ workspaceId, projectCount: result.length }, 'Projects listed')
    return result
  } catch (error) {
    log.error({ error: error instanceof Error ? error.message : String(error), workspaceId }, 'listProjects failed')
    throw classifyKaneoError(error)
  }
}
