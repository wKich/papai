import { tool, type ToolSet } from 'ai'
import { z } from 'zod'

import { getConfig, setConfig } from '../config.js'
import { parseCron } from '../cron.js'
import { logger } from '../logger.js'
import { ProviderClassifiedError } from '../providers/errors.js'
import type { TaskProvider } from '../providers/types.js'
import * as briefingService from './briefing.js'
import * as reminderService from './reminders.js'
import * as scheduler from './scheduler.js'

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
    description: "Manually generate and return today's full briefing on demand.",
    inputSchema: z.object({}),
    execute: async () => {
      log.debug({ userId }, 'get_briefing called')
      const content = await briefingService.generate(userId, provider)
      return { briefing: content }
    },
  })
}

function makeConfigureBriefingTool(userId: string): ToolSet[string] {
  return tool({
    description:
      'Schedule or cancel the daily morning briefing. The briefing is sent once per day at the configured time in the user\'s timezone. Pass a time like "09:00" (24-hour HH:MM) to enable it, or null to disable it.',
    inputSchema: z.object({
      time: z
        .string()
        .nullable()
        .optional()
        .describe(
          '24-hour HH:MM time string (e.g. "08:30") to schedule the briefing, or null/empty string to disable it. Omit to query current status without changes.',
        ),
    }),
    execute: ({ time }) => {
      log.debug({ userId, time }, 'configure_briefing called')

      if (time === undefined) {
        const currentTime = getConfig(userId, 'briefing_time') ?? ''
        const timezone = getConfig(userId, 'timezone') ?? 'UTC'
        if (currentTime === '') {
          return { status: 'disabled' }
        }
        return { status: 'scheduled', time: currentTime, timezone }
      }

      if (time === null || time === '') {
        setConfig(userId, 'briefing_time', '')
        scheduler.unregisterBriefingJob(userId)
        log.info({ userId }, 'Daily briefing disabled')
        return { status: 'disabled' }
      }

      // Validate HH:MM format
      const match = /^([01]\d|2[0-3]):([0-5]\d)$/.exec(time)
      if (match === null) {
        return { error: `Invalid time format "${time}". Please use 24-hour HH:MM format (e.g. "09:00").` }
      }

      const timezone = getConfig(userId, 'timezone') ?? 'UTC'
      setConfig(userId, 'briefing_time', time)
      scheduler.registerBriefingJob(userId, time, timezone)

      log.info({ userId, time, timezone }, 'Daily briefing scheduled')
      return { status: 'scheduled', time, timezone }
    },
  })
}

function makeConfigureAlertsTool(userId: string): ToolSet[string] {
  return tool({
    description:
      'Enable or disable proactive deadline and staleness alerts. When enabled, the bot will notify you about tasks due soon, overdue tasks, and tasks stuck in the same status for too long.',
    inputSchema: z.object({
      enabled: z.boolean().describe('Whether to enable deadline and staleness alerts'),
      stalenessDays: z
        .number()
        .int()
        .min(1)
        .optional()
        .describe(
          'How many days a task must remain in the same status before triggering a staleness alert. Defaults to 7.',
        ),
    }),
    execute: ({ enabled, stalenessDays }) => {
      log.debug({ userId, enabled, stalenessDays }, 'configure_alerts called')

      setConfig(userId, 'deadline_nudges', enabled ? 'enabled' : 'disabled')

      if (stalenessDays !== undefined) {
        setConfig(userId, 'staleness_days', String(stalenessDays))
      }

      const storedStaleness = Number.parseInt(getConfig(userId, 'staleness_days') ?? '7', 10)
      let effectiveStaleness = stalenessDays ?? storedStaleness

      if (!Number.isFinite(effectiveStaleness) || effectiveStaleness < 1) {
        effectiveStaleness = 7
      }

      setConfig(userId, 'staleness_days', String(effectiveStaleness))

      log.info({ userId, enabled, stalenessDays: effectiveStaleness }, 'Alerts configured')
      return { status: enabled ? 'enabled' : 'disabled', stalenessDays: effectiveStaleness }
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
    configure_briefing: makeConfigureBriefingTool(userId),
    configure_alerts: makeConfigureAlertsTool(userId),
  }
}
