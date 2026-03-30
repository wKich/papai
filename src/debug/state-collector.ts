import { getSessionSnapshots } from '../cache-snapshots.js'
import { getPollerSnapshot } from '../deferred-prompts/poller.js'
import { getMessageCacheSnapshot } from '../message-cache/cache.js'
import { getSchedulerSnapshot } from '../scheduler.js'
import { getWizardSnapshots } from '../wizard/state.js'
import { subscribe, unsubscribe, type DebugEvent } from './event-bus.js'

let adminUserId: string | null = null

const clients = new Set<ReadableStreamDefaultController>()
const encoder = new TextEncoder()

export const stats = {
  startedAt: Date.now(),
  totalMessages: 0,
  totalLlmCalls: 0,
  totalToolCalls: 0,
}

const LLM_TRACE_CAPACITY = 65535

type LlmTrace = {
  timestamp: number
  userId: string
  model: string
  steps: number
  totalTokens: { inputTokens: number; outputTokens: number }
  duration: number
  toolCalls: Array<{ toolName: string; durationMs: number; success: boolean }>
  error?: string
}

export const recentLlm: LlmTrace[] = []

type PendingLlmTrace = {
  startTimestamp: number
  userId: string
  model: string
  toolCalls: Array<{ toolName: string; durationMs: number; success: boolean }>
}

export const pendingTraces = new Map<string, PendingLlmTrace>()

function str(value: unknown): string {
  return typeof value === 'string' ? value : ''
}

function num(value: unknown): number {
  return typeof value === 'number' ? value : 0
}

function bool(value: unknown): boolean {
  return typeof value === 'boolean' ? value : false
}

function isTokenRecord(v: unknown): v is { inputTokens: unknown; outputTokens: unknown } {
  return typeof v === 'object' && v !== null && 'inputTokens' in v && 'outputTokens' in v
}

function tokenUsage(value: unknown): { inputTokens: number; outputTokens: number } {
  if (isTokenRecord(value)) {
    return { inputTokens: num(value.inputTokens), outputTokens: num(value.outputTokens) }
  }
  return { inputTokens: 0, outputTokens: 0 }
}

export function init(adminId: string): void {
  adminUserId = adminId
}

export function addClient(controller: ReadableStreamDefaultController): void {
  clients.add(controller)

  const initData: Record<string, unknown> = {
    sessions: adminUserId === null ? [] : getSessionSnapshots(adminUserId),
    wizards: adminUserId === null ? [] : getWizardSnapshots(adminUserId),
    scheduler: getSchedulerSnapshot(),
    pollers: getPollerSnapshot(),
    messageCache: getMessageCacheSnapshot(),
    stats,
    recentLlm,
  }

  sendTo(controller, { type: 'state:init', timestamp: Date.now(), data: initData })

  if (clients.size === 1) {
    subscribe(onEvent)
  }
}

export function removeClient(controller: ReadableStreamDefaultController): void {
  clients.delete(controller)

  if (clients.size === 0) {
    unsubscribe(onEvent)
  }
}

function isAdminEvent(event: DebugEvent): boolean {
  const eventUserId = event.data['userId']
  if (typeof eventUserId !== 'string') return true
  return eventUserId === adminUserId
}

let statsDebounceTimer: ReturnType<typeof setTimeout> | null = null

function scheduleStatsBroadcast(): void {
  if (statsDebounceTimer !== null) return
  statsDebounceTimer = setTimeout(() => {
    statsDebounceTimer = null
    broadcast({ type: 'state:stats', timestamp: Date.now(), data: { ...stats } })
  }, 500)
}

function pushTrace(trace: LlmTrace): void {
  if (recentLlm.length >= LLM_TRACE_CAPACITY) recentLlm.shift()
  recentLlm.push(trace)
}

function traceToData(trace: LlmTrace): Record<string, unknown> {
  const result: Record<string, unknown> = { ...trace }
  return result
}

function broadcastTrace(trace: LlmTrace, timestamp: number): void {
  broadcast({ type: 'llm:full', timestamp, data: traceToData(trace) })
}

function handleLlmStart(event: DebugEvent, userId: string): void {
  pendingTraces.set(userId, {
    startTimestamp: event.timestamp,
    userId,
    model: str(event.data['model']),
    toolCalls: [],
  })
}

function handleLlmToolResult(event: DebugEvent, userId: string): void {
  const pending = pendingTraces.get(userId)
  if (pending !== undefined) {
    pending.toolCalls.push({
      toolName: str(event.data['toolName']),
      durationMs: num(event.data['durationMs']),
      success: bool(event.data['success']),
    })
  }
  stats.totalToolCalls++
  scheduleStatsBroadcast()
}

function handleLlmEnd(event: DebugEvent, userId: string): void {
  const pending = pendingTraces.get(userId)
  pendingTraces.delete(userId)
  const trace: LlmTrace = {
    timestamp: event.timestamp,
    userId,
    model: pending?.model ?? str(event.data['model']),
    steps: num(event.data['steps']),
    totalTokens: tokenUsage(event.data['tokenUsage']),
    duration: num(event.data['totalDuration']),
    toolCalls: pending?.toolCalls ?? [],
  }
  pushTrace(trace)
  stats.totalLlmCalls++
  scheduleStatsBroadcast()
  broadcastTrace(trace, event.timestamp)
}

function handleLlmError(event: DebugEvent, userId: string): void {
  const pending = pendingTraces.get(userId)
  pendingTraces.delete(userId)
  const trace: LlmTrace = {
    timestamp: event.timestamp,
    userId,
    model: pending?.model ?? str(event.data['model']),
    steps: 0,
    totalTokens: { inputTokens: 0, outputTokens: 0 },
    duration: pending === undefined ? 0 : event.timestamp - pending.startTimestamp,
    toolCalls: pending?.toolCalls ?? [],
    error: str(event.data['error']),
  }
  pushTrace(trace)
  broadcastTrace(trace, event.timestamp)
}

function handleLlmTraceAccumulation(event: DebugEvent): void {
  const userId = str(event.data['userId'])

  if (event.type === 'llm:start') handleLlmStart(event, userId)
  else if (event.type === 'llm:tool_result') handleLlmToolResult(event, userId)
  else if (event.type === 'llm:end') handleLlmEnd(event, userId)
  else if (event.type === 'llm:error') handleLlmError(event, userId)
}

function handleStatsUpdate(event: DebugEvent): void {
  if (event.type === 'message:received') {
    stats.totalMessages++
    scheduleStatsBroadcast()
  }
}

function onEvent(event: DebugEvent): void {
  if (!isAdminEvent(event)) return
  handleLlmTraceAccumulation(event)
  handleStatsUpdate(event)
  broadcast(event)
}

function broadcast(event: DebugEvent): void {
  const payload = formatSse(event)
  for (const client of clients) {
    try {
      client.enqueue(payload)
    } catch {
      clients.delete(client)
    }
  }
}

function sendTo(controller: ReadableStreamDefaultController, event: DebugEvent): void {
  try {
    controller.enqueue(formatSse(event))
  } catch {
    clients.delete(controller)
  }
}

function formatSse(event: DebugEvent): Uint8Array {
  return encoder.encode(`event: ${event.type}\ndata: ${JSON.stringify(event)}\n\n`)
}
