import { tool, type ToolSet } from 'ai'
import { z } from 'zod'

import { getConfig } from '../config.js'
import { parseCron } from '../cron.js'
import { logger } from '../logger.js'
import { ProviderClassifiedError } from '../providers/errors.js'
import type { TaskProvider } from '../providers/types.js'
import * as briefingService from './briefing.js'
import * as reminderService from './reminders.js'

const log = logger.child({ scope: 'proactive:tools' })

function handleReminderError(error: unknown, reminderId: string): { error: string } {
  if (error instanceof ProviderClassifiedError && error.error.code === 'not-found') {
    return { error: `Reminder "${reminderId}" not found or does not belong to you.` }
  }
  throw error
}

function makeSetReminderTool(userId: string): ToolSet[string] {
  return tool({
    description:
      'Create a one-time or repeating reminder. Resolve all natural language time expressions (e.g. "tomorrow at 9am", "in 3 hours", "every Friday at 4pm") into explicit ISO 8601 timestamps for fireAt and optional 5-field cron expressions for recurrence BEFORE calling this tool.',
    inputSchema: z.object({
      text: z.string().describe('The reminder message to deliver'),
      fireAt: z.string().describe('ISO 8601 timestamp for when to fire the reminder'),
      recurrence: z
        .string()
        .optional()
        .describe('5-field cron expression for repeating reminders (e.g. "0 9 * * 5" for every Friday at 9am)'),
      taskId: z.string().optional().describe('Optional task ID to link this reminder to'),
    }),
    execute: ({ text, fireAt, recurrence, taskId }) => {
      log.debug({ userId, fireAt, hasRecurrence: recurrence !== undefined }, 'set_reminder called')

      const fireDate = Date.parse(fireAt)
      if (Number.isNaN(fireDate)) {
        return { error: `Invalid fireAt timestamp: "${fireAt}". Please provide a valid ISO 8601 timestamp.` }
      }
      if (fireDate <= Date.now()) {
        return { error: `The reminder time "${fireAt}" is in the past. Please provide a future time.` }
      }

      if (recurrence !== undefined) {
        const parsed = parseCron(recurrence)
        if (parsed === null) {
          return {
            error: `Invalid recurrence expression: "${recurrence}". Please provide a valid 5-field cron expression.`,
          }
        }
      }

      const normalizedFireAt = new Date(fireDate).toISOString()
      const reminder = reminderService.createReminder({ userId, text, fireAt: normalizedFireAt, recurrence, taskId })

      return {
        status: 'created',
        reminderId: reminder.id,
        text: reminder.text,
        fireAt: reminder.fireAt,
        recurrence: reminder.recurrence ?? undefined,
      }
    },
  })
}

function makeListRemindersTool(userId: string): ToolSet[string] {
  return tool({
    description: "List the user's active reminders.",
    inputSchema: z.object({
      includeDelivered: z.boolean().optional().default(false).describe('Include already-delivered reminders'),
    }),
    execute: ({ includeDelivered }) => {
      log.debug({ userId, includeDelivered }, 'list_reminders called')
      const list = reminderService.listReminders(userId, includeDelivered)

      if (list.length === 0) {
        return { message: 'No active reminders.' }
      }

      return {
        reminders: list.map((r) => ({
          id: r.id,
          text: r.text,
          fireAt: r.fireAt,
          status: r.status,
          recurrence: r.recurrence ?? undefined,
          taskId: r.taskId ?? undefined,
        })),
      }
    },
  })
}

function makeCancelReminderTool(userId: string): ToolSet[string] {
  return tool({
    description: 'Cancel a pending or snoozed reminder.',
    inputSchema: z.object({
      reminderId: z.string().describe('The ID of the reminder to cancel'),
    }),
    execute: ({ reminderId }) => {
      log.debug({ userId, reminderId }, 'cancel_reminder called')
      try {
        reminderService.cancelReminder(reminderId, userId)
        return { status: 'cancelled', reminderId }
      } catch (error) {
        return handleReminderError(error, reminderId)
      }
    },
  })
}

function validateNewFireAt(newFireAt: string): { error: string } | null {
  const parsed = Date.parse(newFireAt)
  if (Number.isNaN(parsed)) {
    return { error: `Invalid newFireAt timestamp: "${newFireAt}". Please provide a valid ISO 8601 timestamp.` }
  }
  if (parsed <= Date.now()) {
    return { error: `The new fire time "${newFireAt}" is in the past. Please provide a future time.` }
  }
  return null
}

function makeSnoozeReminderTool(userId: string): ToolSet[string] {
  return tool({
    description:
      'Snooze a reminder by extending its next fire time. Resolve the snooze duration to an explicit ISO 8601 timestamp for newFireAt BEFORE calling this tool.',
    inputSchema: z.object({
      reminderId: z.string().describe('The ID of the reminder to snooze'),
      newFireAt: z.string().describe('New ISO 8601 timestamp for when to fire the reminder'),
    }),
    execute: ({ reminderId, newFireAt }) => {
      log.debug({ userId, reminderId, newFireAt }, 'snooze_reminder called')
      const validationError = validateNewFireAt(newFireAt)
      if (validationError !== null) return validationError
      try {
        const normalized = new Date(newFireAt).toISOString()
        reminderService.snoozeReminder(reminderId, userId, normalized)
        return { status: 'snoozed', reminderId, newFireAt: normalized }
      } catch (error) {
        return handleReminderError(error, reminderId)
      }
    },
  })
}

function makeRescheduleReminderTool(userId: string): ToolSet[string] {
  return tool({
    description:
      'Move a reminder to an entirely new time. Resolve the new time to an explicit ISO 8601 timestamp for newFireAt BEFORE calling this tool.',
    inputSchema: z.object({
      reminderId: z.string().describe('The ID of the reminder to reschedule'),
      newFireAt: z.string().describe('New ISO 8601 timestamp for when to fire the reminder'),
    }),
    execute: ({ reminderId, newFireAt }) => {
      log.debug({ userId, reminderId, newFireAt }, 'reschedule_reminder called')
      const validationError = validateNewFireAt(newFireAt)
      if (validationError !== null) return validationError
      try {
        const normalized = new Date(newFireAt).toISOString()
        reminderService.rescheduleReminder(reminderId, userId, normalized)
        return { status: 'rescheduled', reminderId, newFireAt: normalized }
      } catch (error) {
        return handleReminderError(error, reminderId)
      }
    },
  })
}

function makeGetBriefingTool(userId: string, provider: TaskProvider): ToolSet[string] {
  return tool({
    description: "Manually generate and return today's briefing on demand.",
    inputSchema: z.object({
      mode: z
        .enum(['short', 'full'])
        .optional()
        .describe('Briefing mode: "short" for summary counts, "full" for detailed sections'),
    }),
    execute: async ({ mode }) => {
      log.debug({ userId, mode }, 'get_briefing called')
      const configuredMode = getConfig(userId, 'briefing_mode') === 'short' ? 'short' : 'full'
      const effectiveMode = mode ?? configuredMode
      const content = await briefingService.generate(userId, provider, effectiveMode)
      return { briefing: content }
    },
  })
}

export function makeProactiveTools(userId: string, provider: TaskProvider): ToolSet {
  return {
    set_reminder: makeSetReminderTool(userId),
    list_reminders: makeListRemindersTool(userId),
    cancel_reminder: makeCancelReminderTool(userId),
    snooze_reminder: makeSnoozeReminderTool(userId),
    reschedule_reminder: makeRescheduleReminderTool(userId),
    get_briefing: makeGetBriefingTool(userId, provider),
  }
}
