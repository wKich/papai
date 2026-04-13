import { tool } from 'ai'
import type { ToolSet } from 'ai'
import { z } from 'zod'

import { getConfig } from '../config.js'
import { resolveMeReference } from '../identity/resolver.js'
import { logger } from '../logger.js'
import type { ListTasksParams, TaskProvider } from '../providers/types.js'
import { utcToLocal } from '../utils/datetime.js'

const log = logger.child({ scope: 'tool:list-tasks' })

interface ResolveAssigneeFilterResult {
  params: ListTasksParams
  identityRequired?: { status: 'identity_required'; message: string }
}

async function resolveAssigneeFilter(
  params: ListTasksParams,
  userId: string | undefined,
  provider: TaskProvider,
): Promise<ResolveAssigneeFilterResult> {
  const assigneeId = params.assigneeId
  if (assigneeId === undefined || assigneeId.toLowerCase() !== 'me' || userId === undefined) {
    return { params }
  }

  const identity = await resolveMeReference(userId, provider)
  if (identity.type === 'found') {
    const identifier = provider.preferredUserIdentifier === 'login' ? identity.identity.login : identity.identity.userId
    return {
      params: {
        ...params,
        assigneeId: identifier,
      },
    }
  }
  return {
    params,
    identityRequired: { status: 'identity_required', message: identity.message },
  }
}

export function makeListTasksTool(provider: TaskProvider, userId?: string, storageContextId?: string): ToolSet[string] {
  return tool({
    description:
      'List tasks in a project. Optional filters match the upstream @kaneo/mcp list_tasks tool (status, priority, assignee, pagination, sort, due-date range).',
    inputSchema: z.object({
      projectId: z.string().describe('Project ID to list tasks from'),
      status: z.string().optional().describe('Filter by status column slug'),
      priority: z.enum(['no-priority', 'low', 'medium', 'high', 'urgent']).optional().describe('Filter by priority'),
      assigneeId: z.string().optional().describe('Filter by assignee user ID'),
      page: z.number().int().positive().optional().describe('Page number (1-based)'),
      limit: z.number().int().positive().optional().describe('Max tasks per page'),
      sortBy: z
        .enum(['createdAt', 'priority', 'dueDate', 'position', 'title', 'number'])
        .optional()
        .describe('Field to sort by'),
      sortOrder: z.enum(['asc', 'desc']).optional().describe('Sort direction'),
      dueBefore: z.iso.datetime({ offset: true }).optional().describe('Only tasks due before this ISO date'),
      dueAfter: z.iso.datetime({ offset: true }).optional().describe('Only tasks due after this ISO date'),
    }),
    execute: async ({ projectId, ...rest }) => {
      const params: ListTasksParams = rest
      try {
        const { params: resolvedParams, identityRequired } = await resolveAssigneeFilter(params, userId, provider)
        if (identityRequired !== undefined) {
          return identityRequired
        }

        const tasks = await provider.listTasks(projectId, resolvedParams)
        log.info({ projectId, taskCount: tasks.length, filters: rest }, 'Tasks listed via tool')
        // NI2 Fix: Use storageContextId for config lookup (per-user config stored there)
        // Falls back to userId for backwards compatibility, then UTC
        const configKey = storageContextId ?? userId
        const timezone = configKey === undefined ? 'UTC' : (getConfig(configKey, 'timezone') ?? 'UTC')
        return tasks.map((task) => ({ ...task, dueDate: utcToLocal(task.dueDate, timezone) }))
      } catch (error) {
        log.error(
          { error: error instanceof Error ? error.message : String(error), projectId, tool: 'list_tasks' },
          'Tool execution failed',
        )
        throw error
      }
    },
  })
}
