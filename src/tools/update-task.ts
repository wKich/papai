import { tool } from 'ai'
import type { ToolSet } from 'ai'
import { z } from 'zod'

import { getConfig } from '../config.js'
import { resolveMeReference } from '../identity/resolver.js'
import { logger } from '../logger.js'
import type { TaskProvider } from '../providers/types.js'
import { localDatetimeToUtc, utcToLocal } from '../utils/datetime.js'
import type { CompletionHookFn } from './completion-hook.js'

const log = logger.child({ scope: 'tool:update-task' })

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

const inputSchema = z.object({
  taskId: z.string().describe('The task ID'),
  title: z.string().optional().describe('New task title'),
  description: z.string().optional().describe('New task description'),
  status: z.string().optional().describe("New status column slug (e.g. 'to-do', 'in-progress', 'in-review', 'done')"),
  priority: z
    .string()
    .trim()
    .min(1)
    .optional()
    .describe("New priority value. Must match the upstream provider's configured priority values."),
  dueDate: z
    .object({
      date: z.string().describe("Date in YYYY-MM-DD format (user's local date)"),
      time: z.string().optional().describe('Time in HH:MM 24-hour format (ignored for YouTrack due dates)'),
    })
    .optional()
    .describe(
      "Due date input. For most providers, date+time is converted from the user's local time to UTC. For YouTrack, due dates are date-only and time-of-day is ignored.",
    ),
  assignee: z.string().optional().describe('User ID to assign the task to'),
  projectId: z.string().optional().describe('Project ID to move the task to'),
  customFields: z
    .array(z.object({ name: z.string(), value: z.string() }))
    .optional()
    .describe('Provider-safe custom field writes. For YouTrack this is limited to simple string/text project fields.'),
})

export function makeUpdateTaskTool(
  provider: TaskProvider,
  completionHook?: CompletionHookFn,
  userId?: string,
  storageContextId?: string,
): ToolSet[string] {
  return tool({
    description: "Update an existing task's status, priority, assignee, due date, title, description, or project.",
    inputSchema,
    execute: async ({ taskId, title, description, status, priority, dueDate, assignee, projectId, customFields }) => {
      try {
        // NI2 Fix: Use storageContextId for config lookup (per-user config stored there)
        // Falls back to userId for backwards compatibility, then UTC
        const configKey = storageContextId ?? userId
        const timezone = configKey === undefined ? 'UTC' : (getConfig(configKey, 'timezone') ?? 'UTC')
        const resolvedDueDate = resolveToolDueDate(dueDate, timezone, provider)

        const { assignee: resolvedAssignee, identityRequired } = await resolveAssignee(assignee, userId, provider)
        if (identityRequired !== undefined) {
          return identityRequired
        }

        const task = await provider.updateTask(taskId, {
          title,
          description,
          status,
          priority,
          dueDate: resolvedDueDate,
          projectId,
          assignee: resolvedAssignee,
          customFields,
        })
        log.info({ taskId }, 'Task updated via tool')

        if (completionHook !== undefined && task.status !== undefined) {
          await completionHook(taskId, task.status, provider)
        }

        return { ...task, dueDate: formatToolDueDate(task.dueDate, timezone, provider) }
      } catch (error) {
        log.error(
          { error: error instanceof Error ? error.message : String(error), taskId, tool: 'update_task' },
          'Tool execution failed',
        )
        throw error
      }
    },
  })
}
