import { logger } from '../logger.js'
import type { TaskListItem, TaskProvider } from '../providers/types.js'

const log = logger.child({ scope: 'proactive:shared' })

export const TERMINAL_STATUS_SLUGS = ['done', 'completed', "won't fix", 'cancelled', 'archived']

export const isTerminalStatus = (status: string | undefined): boolean => {
  if (status === undefined) return false
  const lower = status.toLowerCase()
  return TERMINAL_STATUS_SLUGS.some((slug) => lower.includes(slug))
}

export async function fetchAllTasks(
  provider: TaskProvider,
  logContext: Record<string, unknown> = {},
): Promise<TaskListItem[]> {
  if (provider.capabilities.has('projects.list') && provider.listProjects !== undefined) {
    const projects = await provider.listProjects()
    const results = await Promise.allSettled(projects.slice(0, 20).map((p) => provider.listTasks(p.id)))
    return results.flatMap((r, i) => {
      if (r.status === 'fulfilled') return r.value
      const project = projects[i]!
      log.warn(
        {
          ...logContext,
          projectId: project.id,
          error: r.reason instanceof Error ? r.reason.message : String(r.reason),
        },
        'Failed to list tasks for project',
      )
      return []
    })
  }

  try {
    const results = await provider.searchTasks({ query: '' })
    return results.map((t) => ({
      id: t.id,
      title: t.title,
      number: t.number,
      status: t.status,
      priority: t.priority,
      dueDate: undefined,
      url: t.url,
    }))
  } catch (err) {
    log.warn({ ...logContext, error: err instanceof Error ? err.message : String(err) }, 'Failed to search tasks')
    return []
  }
}
