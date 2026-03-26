import { tool } from 'ai'
import type { ToolSet } from 'ai'
import { z } from 'zod'

import { getConfig } from '../config.js'
import { logger } from '../logger.js'
import { getMemo, addMemoLink } from '../memos.js'
import type { TaskProvider } from '../providers/types.js'
import { localDatetimeToUtc, utcToLocal } from '../utils/datetime.js'

const log = logger.child({ scope: 'tool:memo' })

export function makePromoteMemoTool(provider: TaskProvider, userId: string): ToolSet[string] {
  return tool({
    description: 'Promote a personal note to a tracked task. Call list_memos or search_memos first to get the memo_id.',
    inputSchema: z.object({
      memo_id: z.string().describe('The memo ID to promote'),
      project_id: z.string().describe('Project ID — call list_projects first'),
      title: z.string().optional().describe('Task title — defaults to memo content (truncated)'),
      dueDate: z
        .object({
          date: z.string().describe("Date in YYYY-MM-DD format (user's local date)"),
          time: z.string().optional().describe("Time in HH:MM 24-hour format (user's local time)"),
        })
        .optional()
        .describe("Due date in the user's local time"),
    }),
    execute: ({ memo_id, project_id, title, dueDate }) => {
      log.debug({ userId, memo_id, project_id }, 'promote_memo called')
      return promoteToTask(provider, userId, memo_id, project_id, title, dueDate)
    },
  })
}

async function promoteToTask(
  provider: TaskProvider,
  userId: string,
  memoId: string,
  projectId: string,
  title?: string,
  dueDate?: { date: string; time?: string },
): Promise<Record<string, unknown>> {
  const memo = getMemo(userId, memoId)
  if (memo === null) {
    log.warn({ userId, memo_id: memoId }, 'Memo not found for promotion')
    return { status: 'error', message: `Memo "${memoId}" not found.` }
  }

  const taskTitle = title ?? memo.content.slice(0, 100)
  const timezone = getConfig(userId, 'timezone') ?? 'UTC'
  const resolvedDueDate = dueDate === undefined ? undefined : localDatetimeToUtc(dueDate.date, dueDate.time, timezone)

  const task = await provider.createTask({
    projectId,
    title: taskTitle,
    description: memo.content,
    dueDate: resolvedDueDate,
  })

  addMemoLink(memoId, task.id, 'action_for')
  log.info({ userId, memo_id: memoId, taskId: task.id }, 'Memo promoted to task')

  return {
    status: 'promoted',
    task_id: task.id,
    task_title: task.title,
    task_url: task.url,
    memo_id: memoId,
    dueDate: utcToLocal(task.dueDate, timezone),
  }
}
