import { z } from 'zod'

// Base schemas
export const SessionSchema = z.object({
  userId: z.string(),
  lastAccessed: z.number(),
  historyLength: z.number(),
  factsCount: z.number(),
  summary: z.string().nullable(),
  configKeys: z.array(z.string()),
  workspaceId: z.string().nullable(),
})

export const WizardSchema = z.object({
  userId: z.string(),
  currentStep: z.number(),
  totalSteps: z.number(),
})

export const SchedulerInfoSchema = z.object({
  running: z.boolean().optional(),
  tickCount: z.number().optional(),
})

export const PollersInfoSchema = z.object({
  scheduledRunning: z.boolean().optional(),
  alertsRunning: z.boolean().optional(),
})

export const MessageCacheInfoSchema = z.object({
  size: z.number().optional(),
  pendingWrites: z.number().optional(),
})

export const TokenInfoSchema = z.object({
  inputTokens: z.number(),
  outputTokens: z.number(),
})

export const ToolCallSchema = z.object({
  toolName: z.string(),
  durationMs: z.number(),
  success: z.boolean(),
})

export const LlmTraceSchema = z.object({
  timestamp: z.union([z.string(), z.number()]),
  userId: z.string(),
  model: z.string(),
  duration: z.number(),
  steps: z.number(),
  totalTokens: TokenInfoSchema,
  toolCalls: z.array(ToolCallSchema).optional(),
  error: z.string().optional(),
})

export const LogEntrySchema = z.object({
  time: z.union([z.string(), z.number()]),
  level: z.number(),
  msg: z.string(),
  scope: z.string().optional(),
})

// SSE Event schemas
export const StateInitEventSchema = z.object({
  sessions: z.array(z.unknown()).optional(),
  wizards: z.array(z.unknown()).optional(),
  scheduler: SchedulerInfoSchema.optional(),
  pollers: PollersInfoSchema.optional(),
  messageCache: MessageCacheInfoSchema.optional(),
  stats: z
    .object({
      startedAt: z.number().optional(),
      totalMessages: z.number().optional(),
      totalLlmCalls: z.number().optional(),
      totalToolCalls: z.number().optional(),
    })
    .optional(),
  recentLlm: z.array(z.unknown()).optional(),
})

export const StateStatsEventSchema = z.object({
  startedAt: z.number().optional(),
  totalMessages: z.number().optional(),
  totalLlmCalls: z.number().optional(),
  totalToolCalls: z.number().optional(),
})

export const CacheEventSchema = z.object({
  userId: z.string(),
  field: z.string().optional(),
})

export const UserIdEventSchema = z.object({
  userId: z.string(),
})

export const SchedulerTickEventSchema = z.object({
  running: z.boolean().optional(),
  tickCount: z.number().optional(),
})

export const PollerEventSchema = z.object({
  scheduledRunning: z.boolean().optional(),
  alertsRunning: z.boolean().optional(),
})

export const MessageCacheEventSchema = z.object({
  size: z.number().optional(),
  pendingWrites: z.number().optional(),
})

// Inferred types
export type Session = z.infer<typeof SessionSchema>
export type Wizard = z.infer<typeof WizardSchema>
export type SchedulerInfo = z.infer<typeof SchedulerInfoSchema>
export type PollersInfo = z.infer<typeof PollersInfoSchema>
export type MessageCacheInfo = z.infer<typeof MessageCacheInfoSchema>
export type TokenInfo = z.infer<typeof TokenInfoSchema>
export type ToolCall = z.infer<typeof ToolCallSchema>
export type LlmTrace = z.infer<typeof LlmTraceSchema>
export type LogEntry = z.infer<typeof LogEntrySchema>
export type StateInitEvent = z.infer<typeof StateInitEventSchema>
export type StateStatsEvent = z.infer<typeof StateStatsEventSchema>
export type CacheEvent = z.infer<typeof CacheEventSchema>
export type UserIdEvent = z.infer<typeof UserIdEventSchema>
export type SchedulerTickEvent = z.infer<typeof SchedulerTickEventSchema>
export type PollerEvent = z.infer<typeof PollerEventSchema>
export type MessageCacheEvent = z.infer<typeof MessageCacheEventSchema>

// Validation helpers
export function parseWizard(data: unknown): Wizard {
  return WizardSchema.parse(data)
}

export function parseLlmTrace(data: unknown): LlmTrace {
  return LlmTraceSchema.parse(data)
}

export function parseLogEntry(data: unknown): LogEntry {
  return LogEntrySchema.parse(data)
}

export function parseStateInitEvent(data: unknown): StateInitEvent {
  return StateInitEventSchema.parse(data)
}

export function parseStateStatsEvent(data: unknown): StateStatsEvent {
  return StateStatsEventSchema.parse(data)
}

export function parseCacheEvent(data: unknown): CacheEvent {
  return CacheEventSchema.parse(data)
}

export function parseUserIdEvent(data: unknown): UserIdEvent {
  return UserIdEventSchema.parse(data)
}

export function parseSchedulerTickEvent(data: unknown): SchedulerTickEvent {
  return SchedulerTickEventSchema.parse(data)
}

export function parsePollerEvent(data: unknown): PollerEvent {
  return PollerEventSchema.parse(data)
}

export function parseMessageCacheEvent(data: unknown): MessageCacheEvent {
  return MessageCacheEventSchema.parse(data)
}

// Safe validation helpers that return null on failure
export function safeParseSession(data: unknown): Session | null {
  const result = SessionSchema.safeParse(data)
  return result.success ? result.data : null
}

export function safeParseWizard(data: unknown): Wizard | null {
  const result = WizardSchema.safeParse(data)
  return result.success ? result.data : null
}

export function safeParseLlmTrace(data: unknown): LlmTrace | null {
  const result = LlmTraceSchema.safeParse(data)
  return result.success ? result.data : null
}
