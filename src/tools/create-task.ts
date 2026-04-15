import { tool } from 'ai'
import type { ToolSet } from 'ai'
import { z } from 'zod'

import { getConfig } from '../config.js'
import { resolveMeReference } from '../identity/resolver.js'
import { logger } from '../logger.js'
import type { TaskProvider } from '../providers/types.js'
import { localDatetimeToUtc, utcToLocal } from '../utils/datetime.js'

const log = logger.child({ scope: 'tool:create-task' })

const resolveToolDueDate = (
  dueDate: Readonly<{ date: string; time?: string }> | undefined,
  timezone: string,
  provider: Readonly<TaskProvider>,
): string | undefined => {
  if (dueDate === undefined) return undefined
  if (provider.name === 'youtrack') {
    return dueDate.date
  }
  return localDatetimeToUtc(dueDate.date, dueDate.time, timezone)
}

const formatToolDueDate = (
  dueDate: string | null | undefined,
  timezone: string,
  provider: Readonly<TaskProvider>,
): string | null | undefined => {
  if (
    provider.name === 'youtrack' &&
    dueDate !== undefined &&
    dueDate !== null &&
    /^\d{4}-\d{2}-\d{2}$/.test(dueDate)
  ) {
    return dueDate
  }
  return utcToLocal(dueDate, timezone)
}

interface ResolveAssigneeResult {
  assignee?: string
  identityRequired?: { status: 'identity_required'; message: string }
}

async function resolveAssignee(
  assignee: string | undefined,
  userId: string | undefined,
  provider: TaskProvider,
): Promise<ResolveAssigneeResult> {
  if (assignee === undefined || assignee.toLowerCase() !== 'me' || userId === undefined) {
    return { assignee }
  }

  const identity = await resolveMeReference(userId, provider)
  if (identity.type === 'found') {
    const identifier = provider.preferredUserIdentifier === 'login' ? identity.identity.login : identity.identity.userId
    return { assignee: identifier }
  }
  return { identityRequired: { status: 'identity_required', message: identity.message } }
}

async function executeCreateTask(
  params: {
    title: string
    description?: string
    priority?: string
    projectId: string
    dueDate?: { date: string; time?: string }
    status?: string
    assignee?: string
    customFields?: Array<{ name: string; value: string }>
  },
  userId: string | undefined,
  storageContextId: string | undefined,
  provider: TaskProvider,
): Promise<unknown> {
  const { title, description, priority, projectId, dueDate, status, assignee, customFields } = params
  const configKey = storageContextId ?? userId
  const timezone = configKey === undefined ? 'UTC' : (getConfig(configKey, 'timezone') ?? 'UTC')
  const resolvedDueDate = resolveToolDueDate(dueDate, timezone, provider)
  const { assignee: resolvedAssignee, identityRequired } = await resolveAssignee(assignee, userId, provider)
  if (identityRequired !== undefined) return identityRequired
  const task = await provider.createTask({
    projectId,
    title,
    description,
    priority,
    status,
    dueDate: resolvedDueDate,
    assignee: resolvedAssignee,
    customFields,
  })
  log.info(
    { taskId: task.id, title, hasCustomFields: customFields !== undefined && customFields.length > 0 },
    'Task created via tool',
  )
  return { ...task, dueDate: formatToolDueDate(task.dueDate, timezone, provider) }
}

export function makeCreateTaskTool(
  provider: TaskProvider,
  userId?: string,
  storageContextId?: string,
): ToolSet[string] {
  return tool({
    description: 'Create a new task. Call list_projects first to get a valid projectId.',
    inputSchema: z.object({
      title: z.string().describe('Short, descriptive task title'),
      description: z.string().optional().describe('Detailed description of the task'),
      priority: z
        .string()
        .trim()
        .min(1)
        .optional()
        .describe("Priority value. Must match the upstream provider's configured priority values."),
      projectId: z.string().describe('Project ID — call list_projects first to obtain this'),
      dueDate: z
        .object({
          date: z.string().describe("Date in YYYY-MM-DD format (user's local date)"),
          time: z.string().optional().describe('Time in HH:MM 24-hour format (ignored for YouTrack due dates)'),
        })
        .optional()
        .describe(
          "Due date input. For most providers, date+time is converted from the user's local time to UTC. For YouTrack, due dates are date-only and time-of-day is ignored.",
        ),
      status: z.string().optional().describe("Status column slug (e.g. 'to-do', 'in-progress', 'done')"),
      assignee: z.string().optional().describe("User ID to assign the task to, or 'me' to assign to yourself"),
      customFields: z
        .array(z.object({ name: z.string(), value: z.string() }))
        .optional()
        .describe(
          'For YouTrack, only use this for simple string/text project fields required by YouTrack workflows, not arbitrary field types.',
        ),
    }),
    execute: async (params) => {
      try {
        return await executeCreateTask(params, userId, storageContextId, provider)
      } catch (error) {
        log.error(
          { error: error instanceof Error ? error.message : String(error), title: params.title, tool: 'create_task' },
          'Tool execution failed',
        )
        throw error
      }
    },
  })
}
