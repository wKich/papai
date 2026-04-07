import type { ListTasksParams } from '../types.js'

/**
 * Build the query-string record for `GET /task/tasks/:projectId` from a
 * `ListTasksParams` object. Mirrors the parameter set accepted by the
 * upstream @kaneo/mcp `list_tasks` tool.
 */
export function buildListTasksQuery(params: ListTasksParams): Record<string, string> {
  const query: Record<string, string> = {}
  for (const [key, value] of Object.entries(params)) {
    if (value === undefined || value === null) {
      continue
    }
    query[key] = String(value)
  }
  return query
}
