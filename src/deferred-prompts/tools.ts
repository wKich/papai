import { tool } from 'ai'
import type { ToolSet } from 'ai'
import { z } from 'zod'

import { getConfig } from '../config.js'
import { nextCronOccurrence, parseCron } from '../cron.js'
import { logger } from '../logger.js'
import { cancelAlertPrompt, createAlertPrompt, getAlertPrompt, listAlertPrompts, updateAlertPrompt } from './alerts.js'
import {
  cancelScheduledPrompt,
  createScheduledPrompt,
  getScheduledPrompt,
  listScheduledPrompts,
  updateScheduledPrompt,
} from './scheduled.js'
import {
  alertConditionSchema,
  type AlertCondition,
  type CancelResult,
  type CreateResult,
  type GetResult,
  type ListResult,
  type UpdateResult,
} from './types.js'

const log = logger.child({ scope: 'deferred:tools' })

type ScheduleInput = { fire_at?: string; cron?: string }

function createScheduled(userId: string, prompt: string, schedule: ScheduleInput): CreateResult {
  const hasFireAt = schedule.fire_at !== undefined && schedule.fire_at !== ''
  const hasCron = schedule.cron !== undefined && schedule.cron !== ''

  if (hasFireAt) {
    const fireDate = new Date(schedule.fire_at!)
    if (Number.isNaN(fireDate.getTime())) return { error: `Invalid fire_at timestamp: '${schedule.fire_at!}'` }
    if (fireDate.getTime() <= Date.now()) return { error: 'fire_at must be a future timestamp.' }
  }

  let cronExpression: string | undefined
  if (hasCron) {
    if (parseCron(schedule.cron!) === null) return { error: `Invalid cron expression: '${schedule.cron!}'` }
    cronExpression = schedule.cron!
  }

  let fireAt: string
  if (hasFireAt) {
    fireAt = new Date(schedule.fire_at!).toISOString()
  } else if (hasCron) {
    const timezone = getConfig(userId, 'timezone') ?? 'UTC'
    const next = nextCronOccurrence(parseCron(cronExpression!)!, new Date(), timezone)
    if (next === null) return { error: 'Could not compute next occurrence for the given cron expression.' }
    fireAt = next.toISOString()
  } else {
    return { error: 'Schedule must include either fire_at or cron.' }
  }

  const result = createScheduledPrompt(userId, prompt, { fireAt, cronExpression })
  log.info({ id: result.id, userId, type: 'scheduled' }, 'Deferred prompt created')
  return {
    status: 'created',
    type: 'scheduled',
    id: result.id,
    fireAt: result.fireAt,
    cronExpression: result.cronExpression,
  }
}

function createAlert(userId: string, prompt: string, condition: unknown, cooldownMinutes?: number): CreateResult {
  const parseResult = alertConditionSchema.safeParse(condition)
  if (!parseResult.success) return { error: `Invalid condition: ${parseResult.error.message}` }

  const result = createAlertPrompt(userId, prompt, parseResult.data, cooldownMinutes)
  log.info({ id: result.id, userId, type: 'alert' }, 'Deferred prompt created')
  return { status: 'created', type: 'alert', id: result.id, cooldownMinutes: result.cooldownMinutes }
}

function executeCreate(
  userId: string,
  input: { prompt: string; schedule?: ScheduleInput; condition?: AlertCondition; cooldown_minutes?: number },
): CreateResult {
  const hasSchedule = input.schedule !== undefined
  const hasCondition = input.condition !== undefined
  log.debug({ userId, hasSchedule, hasCondition }, 'create_deferred_prompt called')

  if (hasSchedule && hasCondition) return { error: 'Provide either a schedule or a condition, not both.' }
  if (!hasSchedule && !hasCondition) {
    return { error: 'Provide either a schedule (for time-based) or a condition (for event-based).' }
  }

  if (hasSchedule) return createScheduled(userId, input.prompt, input.schedule!)
  return createAlert(userId, input.prompt, input.condition, input.cooldown_minutes)
}

function executeList(
  userId: string,
  input: { type?: 'scheduled' | 'alert'; status?: 'active' | 'completed' | 'cancelled' },
): ListResult {
  log.debug({ userId, type: input.type, status: input.status }, 'list_deferred_prompts called')
  const prompts: ListResult['prompts'] = []
  if (input.type !== 'alert') prompts.push(...listScheduledPrompts(userId, input.status))
  if (input.type !== 'scheduled') prompts.push(...listAlertPrompts(userId, input.status))
  log.info({ userId, count: prompts.length }, 'Listed deferred prompts')
  return { prompts }
}

function executeGet(userId: string, input: { id: string }): GetResult {
  log.debug({ userId, id: input.id }, 'get_deferred_prompt called')
  return (
    getScheduledPrompt(input.id, userId) ?? getAlertPrompt(input.id, userId) ?? { error: 'Deferred prompt not found.' }
  )
}

type UpdateInput = {
  id: string
  prompt?: string
  schedule?: ScheduleInput
  condition?: AlertCondition
  cooldown_minutes?: number
}

function updateScheduledFields(id: string, userId: string, input: UpdateInput): UpdateResult {
  if (input.condition !== undefined)
    return { error: 'Cannot apply a condition to a scheduled prompt. Use schedule fields instead.' }
  const updates: { prompt?: string; fireAt?: string; cronExpression?: string } = {}
  if (input.prompt !== undefined) updates.prompt = input.prompt
  if (input.schedule !== undefined) {
    if (input.schedule.fire_at !== undefined) updates.fireAt = input.schedule.fire_at
    if (input.schedule.cron !== undefined) {
      if (parseCron(input.schedule.cron) === null) return { error: `Invalid cron expression: '${input.schedule.cron}'` }
      updates.cronExpression = input.schedule.cron
    }
  }
  const result = updateScheduledPrompt(id, userId, updates)
  if (result === null) return { error: 'Deferred prompt not found.' }
  log.info({ id, userId }, 'Scheduled prompt updated via tool')
  return { ...result, status: 'updated' as const }
}

function updateAlertFields(id: string, userId: string, input: UpdateInput): UpdateResult {
  if (input.schedule !== undefined)
    return { error: 'Cannot apply a schedule to an alert prompt. Use condition fields instead.' }
  const updates: { prompt?: string; condition?: AlertCondition; cooldownMinutes?: number } = {}
  if (input.prompt !== undefined) updates.prompt = input.prompt
  if (input.condition !== undefined) {
    const parseResult = alertConditionSchema.safeParse(input.condition)
    if (!parseResult.success) return { error: `Invalid condition: ${parseResult.error.message}` }
    updates.condition = parseResult.data
  }
  if (input.cooldown_minutes !== undefined) updates.cooldownMinutes = input.cooldown_minutes
  const result = updateAlertPrompt(id, userId, updates)
  if (result === null) return { error: 'Deferred prompt not found.' }
  log.info({ id, userId }, 'Alert prompt updated via tool')
  return { ...result, status: 'updated' as const }
}

function executeUpdate(userId: string, input: UpdateInput): UpdateResult {
  log.debug({ userId, id: input.id }, 'update_deferred_prompt called')
  if (getScheduledPrompt(input.id, userId) !== null) return updateScheduledFields(input.id, userId, input)
  if (getAlertPrompt(input.id, userId) !== null) return updateAlertFields(input.id, userId, input)
  return { error: 'Deferred prompt not found.' }
}

function executeCancel(userId: string, input: { id: string }): CancelResult {
  log.debug({ userId, id: input.id }, 'cancel_deferred_prompt called')
  if (cancelScheduledPrompt(input.id, userId) !== null) {
    log.info({ id: input.id, userId, type: 'scheduled' }, 'Deferred prompt cancelled')
    return { status: 'cancelled', id: input.id }
  }
  if (cancelAlertPrompt(input.id, userId) !== null) {
    log.info({ id: input.id, userId, type: 'alert' }, 'Deferred prompt cancelled')
    return { status: 'cancelled', id: input.id }
  }
  return { error: 'Deferred prompt not found.' }
}

function logAndRethrow(name: string, error: unknown): never {
  log.error({ error: error instanceof Error ? error.message : String(error), tool: name }, 'Tool execution failed')
  throw error
}

const scheduleSchema = z.object({
  fire_at: z.string().optional().describe('ISO 8601 timestamp for one-time execution'),
  cron: z.string().optional().describe('5-field cron expression for recurring execution'),
})

const cooldownSchema = z
  .number()
  .int()
  .min(1)
  .optional()
  .describe('Minimum minutes between alert triggers (default: 60)')

type CreateInput = { prompt: string; schedule?: ScheduleInput; condition?: AlertCondition; cooldown_minutes?: number }
type ListInput = { type?: 'scheduled' | 'alert'; status?: 'active' | 'completed' | 'cancelled' }
type IdInput = { id: string }

function makeCreateTool(userId: string): ToolSet[string] {
  return tool({
    description:
      'Create a scheduled task or monitoring alert. Provide either a schedule (for time-based) or a condition (for event-based), not both.',
    inputSchema: z.object({
      prompt: z.string().describe('What the LLM should do when this fires'),
      schedule: scheduleSchema.optional().describe('Time-based trigger (one-time or recurring)'),
      condition: alertConditionSchema.optional().describe('Event-based trigger condition'),
      cooldown_minutes: cooldownSchema,
    }),
    execute: (input: CreateInput) => {
      try {
        return executeCreate(userId, input)
      } catch (e) {
        logAndRethrow('create_deferred_prompt', e)
      }
    },
  })
}

function makeListTool(userId: string): ToolSet[string] {
  return tool({
    description: 'List deferred prompts (scheduled tasks and monitoring alerts). Optionally filter by type or status.',
    inputSchema: z.object({
      type: z.enum(['scheduled', 'alert']).optional().describe('Filter by prompt type'),
      status: z.enum(['active', 'completed', 'cancelled']).optional().describe('Filter by status'),
    }),
    execute: (input: ListInput) => {
      try {
        return executeList(userId, input)
      } catch (e) {
        logAndRethrow('list_deferred_prompts', e)
      }
    },
  })
}

function makeGetTool(userId: string): ToolSet[string] {
  return tool({
    description: 'Get full details of a deferred prompt by ID.',
    inputSchema: z.object({ id: z.string().describe('The deferred prompt ID') }),
    execute: (input: IdInput) => {
      try {
        return executeGet(userId, input)
      } catch (e) {
        logAndRethrow('get_deferred_prompt', e)
      }
    },
  })
}

function makeUpdateTool(userId: string): ToolSet[string] {
  return tool({
    description:
      'Update a deferred prompt. For scheduled prompts, update prompt text or schedule. For alerts, update prompt text, condition, or cooldown.',
    inputSchema: z.object({
      id: z.string().describe('The deferred prompt ID'),
      prompt: z.string().optional().describe('Updated prompt text'),
      schedule: scheduleSchema.optional().describe('Updated time-based trigger'),
      condition: alertConditionSchema.optional().describe('Updated event-based trigger condition'),
      cooldown_minutes: cooldownSchema,
    }),
    execute: (input: UpdateInput) => {
      try {
        return executeUpdate(userId, input)
      } catch (e) {
        logAndRethrow('update_deferred_prompt', e)
      }
    },
  })
}

function makeCancelTool(userId: string): ToolSet[string] {
  return tool({
    description: 'Cancel a deferred prompt by ID. Works for both scheduled prompts and alerts.',
    inputSchema: z.object({ id: z.string().describe('The deferred prompt ID to cancel') }),
    execute: (input: IdInput) => {
      try {
        return executeCancel(userId, input)
      } catch (e) {
        logAndRethrow('cancel_deferred_prompt', e)
      }
    },
  })
}

export function makeDeferredPromptTools(userId: string): ToolSet {
  return {
    create_deferred_prompt: makeCreateTool(userId),
    list_deferred_prompts: makeListTool(userId),
    get_deferred_prompt: makeGetTool(userId),
    update_deferred_prompt: makeUpdateTool(userId),
    cancel_deferred_prompt: makeCancelTool(userId),
  }
}
