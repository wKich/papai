import type { ContextType } from '../chat/types.js'
import { dmTarget } from '../chat/types.js'
import { getConfig } from '../config.js'
import { nextCronOccurrence, parseCron } from '../cron.js'
import { logger } from '../logger.js'
import { cronToRrule } from '../recurrence-translator.js'
import { localDatetimeToUtc, utcToLocal } from '../utils/datetime.js'
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
  DEFAULT_EXECUTION_METADATA,
  executionMetadataSchema,
  type AlertCondition,
  type CancelResult,
  type CreateResult,
  type DeferredPromptDeliveryInput,
  type ExecutionMetadata,
  type GetResult,
  type ListResult,
  type ScheduleInput,
  type UpdateResult,
} from './types.js'

const log = logger.child({ scope: 'deferred:tools' })

// --- Input types ---

export type CreateDeliveryContext = {
  userId: string
  storageContextId: string
  contextType: ContextType
  username?: string | null
}

export type CreateInput = {
  prompt: string
  schedule?: ScheduleInput
  condition?: AlertCondition
  cooldown_minutes?: number
  execution?: { mode: 'lightweight' | 'context' | 'full'; delivery_brief: string; context_snapshot?: string }
  delivery?: { audience?: 'personal' | 'shared'; mention_user_ids?: string[] }
}

function buildDeliveryInput(
  ctx: CreateDeliveryContext,
  policy?: { audience?: 'personal' | 'shared'; mention_user_ids?: string[] },
): DeferredPromptDeliveryInput {
  if (ctx.contextType === 'dm') {
    return { ...dmTarget(ctx.userId), createdByUsername: ctx.username ?? null }
  }
  const colonIdx = ctx.storageContextId.indexOf(':')
  const contextId = colonIdx >= 0 ? ctx.storageContextId.slice(0, colonIdx) : ctx.storageContextId
  const threadId = colonIdx >= 0 ? ctx.storageContextId.slice(colonIdx + 1) : null
  const audience = policy?.audience === 'shared' ? 'shared' : 'personal'
  const mentionUserIds = audience === 'shared' ? [] : (policy?.mention_user_ids ?? [ctx.userId])
  return {
    contextId,
    contextType: 'group',
    threadId,
    audience,
    mentionUserIds,
    createdByUserId: ctx.userId,
    createdByUsername: ctx.username ?? null,
  }
}

export type UpdateInput = {
  id: string
  prompt?: string
  schedule?: ScheduleInput
  condition?: AlertCondition
  cooldown_minutes?: number
  execution?: { mode: 'lightweight' | 'context' | 'full'; delivery_brief: string; context_snapshot?: string }
}

export type ListInput = { type?: 'scheduled' | 'alert'; status?: 'active' | 'completed' | 'cancelled' }

// --- Handlers ---

function createScheduled(
  userId: string,
  prompt: string,
  schedule: ScheduleInput,
  executionMetadata: ExecutionMetadata,
  delivery?: DeferredPromptDeliveryInput,
): CreateResult {
  const hasFireAt = schedule.fire_at !== undefined
  const hasCron = schedule.cron !== undefined && schedule.cron !== ''
  const timezone = getConfig(userId, 'timezone') ?? 'UTC'

  if (hasFireAt) {
    const { date, time } = schedule.fire_at!
    const utcStr = localDatetimeToUtc(date, time, timezone)
    const fireDate = new Date(utcStr)
    if (Number.isNaN(fireDate.getTime())) return { error: `Invalid fire_at date/time: '${date}T${time}'` }
    if (fireDate.getTime() <= Date.now()) return { error: 'fire_at must be a future date and time.' }
  }

  let cronExpression: string | undefined
  if (hasCron) {
    if (parseCron(schedule.cron!) === null) return { error: `Invalid cron expression: '${schedule.cron!}'` }
    cronExpression = schedule.cron!
  }

  let fireAt: string
  if (hasFireAt) {
    fireAt = localDatetimeToUtc(schedule.fire_at!.date, schedule.fire_at!.time, timezone)
  } else if (hasCron) {
    const next = nextCronOccurrence(parseCron(cronExpression!)!, new Date(), timezone)
    if (next === null) return { error: 'Could not compute next occurrence for the given cron expression.' }
    fireAt = next.toISOString()
  } else {
    return { error: 'Schedule must include either fire_at or cron.' }
  }

  const result = createScheduledPrompt(userId, prompt, { fireAt, cronExpression }, executionMetadata, delivery)
  log.info({ id: result.id, userId, type: 'scheduled' }, 'Deferred prompt created')
  return {
    status: 'created',
    type: 'scheduled',
    id: result.id,
    fireAt: utcToLocal(result.fireAt, timezone) ?? result.fireAt,
    rrule: result.rrule,
  }
}

function createAlert(
  userId: string,
  prompt: string,
  condition: unknown,
  cooldownMinutes: number | undefined,
  executionMetadata: ExecutionMetadata,
  delivery?: DeferredPromptDeliveryInput,
): CreateResult {
  const parseResult = alertConditionSchema.safeParse(condition)
  if (!parseResult.success) return { error: `Invalid condition: ${parseResult.error.message}` }

  const result = createAlertPrompt(userId, prompt, parseResult.data, cooldownMinutes, executionMetadata, delivery)
  log.info({ id: result.id, userId, type: 'alert' }, 'Deferred prompt created')
  return { status: 'created', type: 'alert', id: result.id, cooldownMinutes: result.cooldownMinutes }
}

function parseExecution(
  input: { mode: 'lightweight' | 'context' | 'full'; delivery_brief: string; context_snapshot?: string } | undefined,
): ExecutionMetadata {
  if (input === undefined) return DEFAULT_EXECUTION_METADATA
  const parseResult = executionMetadataSchema.safeParse(input)
  if (parseResult.success) return parseResult.data
  log.warn({ error: parseResult.error.message }, 'Invalid execution metadata, using default')
  return DEFAULT_EXECUTION_METADATA
}

export function executeCreate(userId: string, input: CreateInput, deliveryCtx?: CreateDeliveryContext): CreateResult {
  const hasSchedule = input.schedule !== undefined
  const hasCondition = input.condition !== undefined
  log.debug({ userId, hasSchedule, hasCondition }, 'create_deferred_prompt called')
  if (hasSchedule && hasCondition) return { error: 'Provide either a schedule or a condition, not both.' }
  if (!hasSchedule && !hasCondition) {
    return { error: 'Provide either a schedule (for time-based) or a condition (for event-based).' }
  }

  const executionMetadata = parseExecution(input.execution)
  const delivery = deliveryCtx === undefined ? undefined : buildDeliveryInput(deliveryCtx, input.delivery)

  if (hasSchedule) return createScheduled(userId, input.prompt, input.schedule!, executionMetadata, delivery)
  return createAlert(userId, input.prompt, input.condition, input.cooldown_minutes, executionMetadata, delivery)
}

export function executeList(
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

export function executeGet(userId: string, input: { id: string }): GetResult {
  log.debug({ userId, id: input.id }, 'get_deferred_prompt called')
  return (
    getScheduledPrompt(input.id, userId) ?? getAlertPrompt(input.id, userId) ?? { error: 'Deferred prompt not found.' }
  )
}

function updateScheduledFields(id: string, userId: string, input: UpdateInput): UpdateResult {
  if (input.condition !== undefined)
    return { error: 'Cannot apply a condition to a scheduled prompt. Use schedule fields instead.' }
  const updates: {
    prompt?: string
    fireAt?: string
    rrule?: string
    dtstartUtc?: string
    executionMetadata?: ExecutionMetadata
  } = {}
  if (input.prompt !== undefined) updates.prompt = input.prompt
  if (input.schedule !== undefined) {
    if (input.schedule.fire_at !== undefined) {
      const { date, time } = input.schedule.fire_at
      const timezone = getConfig(userId, 'timezone') ?? 'UTC'
      const utcStr = localDatetimeToUtc(date, time, timezone)
      const fireAtDate = new Date(utcStr)
      if (Number.isNaN(fireAtDate.getTime())) return { error: `Invalid fire_at: '${date}T${time}'` }
      if (fireAtDate.getTime() <= Date.now()) return { error: 'fire_at must be in the future.' }
      updates.fireAt = utcStr
    }
    if (input.schedule.cron !== undefined) {
      if (parseCron(input.schedule.cron) === null) return { error: `Invalid cron expression: '${input.schedule.cron}'` }
      const fireAt = updates.fireAt ?? new Date().toISOString()
      const translated = cronToRrule(input.schedule.cron, 'UTC', fireAt)
      if (translated !== null) {
        updates.rrule = translated.rrule
        updates.dtstartUtc = translated.dtstartUtc
      }
    }
  }
  if (input.execution !== undefined) {
    const parseResult = executionMetadataSchema.safeParse(input.execution)
    if (parseResult.success) updates.executionMetadata = parseResult.data
  }
  const result = updateScheduledPrompt(id, userId, updates)
  if (result === null) return { error: 'Deferred prompt not found.' }
  log.info({ id, userId }, 'Scheduled prompt updated via tool')
  return { ...result, status: 'updated' as const }
}

function updateAlertFields(id: string, userId: string, input: UpdateInput): UpdateResult {
  if (input.schedule !== undefined)
    return { error: 'Cannot apply a schedule to an alert prompt. Use condition fields instead.' }
  const updates: {
    prompt?: string
    condition?: AlertCondition
    cooldownMinutes?: number
    executionMetadata?: ExecutionMetadata
  } = {}
  if (input.prompt !== undefined) updates.prompt = input.prompt
  if (input.condition !== undefined) {
    const parseResult = alertConditionSchema.safeParse(input.condition)
    if (!parseResult.success) return { error: `Invalid condition: ${parseResult.error.message}` }
    updates.condition = parseResult.data
  }
  if (input.cooldown_minutes !== undefined) updates.cooldownMinutes = input.cooldown_minutes
  if (input.execution !== undefined) {
    const parseResult = executionMetadataSchema.safeParse(input.execution)
    if (parseResult.success) updates.executionMetadata = parseResult.data
  }
  const result = updateAlertPrompt(id, userId, updates)
  if (result === null) return { error: 'Deferred prompt not found.' }
  log.info({ id, userId }, 'Alert prompt updated via tool')
  return { ...result, status: 'updated' as const }
}

export function executeUpdate(userId: string, input: UpdateInput): UpdateResult {
  log.debug({ userId, id: input.id }, 'update_deferred_prompt called')
  if (getScheduledPrompt(input.id, userId) !== null) return updateScheduledFields(input.id, userId, input)
  if (getAlertPrompt(input.id, userId) !== null) return updateAlertFields(input.id, userId, input)
  return { error: 'Deferred prompt not found.' }
}

export function executeCancel(userId: string, input: { id: string }): CancelResult {
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
